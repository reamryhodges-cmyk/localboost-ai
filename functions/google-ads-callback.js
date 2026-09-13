const REDIRECT_URI="https://localboost4u.co.uk/google-ads-callback";

export async function onRequestGet({request,env}){
 try{
  const url=new URL(request.url);
  const code=url.searchParams.get("code");
  const state=url.searchParams.get("state");
  const denied=url.searchParams.get("error");

  if(denied)return go("/dashboard.html?google=cancelled");
  if(!code||!state)return go("/dashboard.html?google=invalid_callback");

  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_TOKEN_KEY){
   return go("/dashboard.html?google=not_configured");
  }

  const user=await auth(request,env);
  if(!user)return go("/?google=login_required");

  const oauth=await env.DB.prepare(`
   SELECT user_id,state,expires_at
   FROM google_oauth_states
   WHERE state=?
   LIMIT 1
  `).bind(state).first();

  if(!oauth)return go("/dashboard.html?google=invalid_state");

  await env.DB.prepare(`
   DELETE FROM google_oauth_states WHERE state=?
  `).bind(state).run();

  if(Number(oauth.user_id)!==Number(user.id)){
   return go("/dashboard.html?google=invalid_state");
  }

  if(new Date(oauth.expires_at).getTime()<=Date.now()){
   return go("/dashboard.html?google=expired");
  }

  const body=new URLSearchParams();
  body.set("code",code);
  body.set("client_id",env.GOOGLE_CLIENT_ID);
  body.set("client_secret",env.GOOGLE_CLIENT_SECRET);
  body.set("redirect_uri",REDIRECT_URI);
  body.set("grant_type","authorization_code");

  const tokenRes=await fetch("https://oauth2.googleapis.com/token",{
   method:"POST",
   headers:{"Content-Type":"application/x-www-form-urlencoded"},
   body:body.toString()
  });

  const tokenData=await tokenRes.json();

  if(!tokenRes.ok){
   console.error("Google token exchange failed",tokenData);
   return go("/dashboard.html?google=token_failed");
  }

  if(!tokenData.refresh_token){
   return go("/dashboard.html?google=no_refresh_token");
  }

  const encrypted=await encryptToken(
   tokenData.refresh_token,
   env.GOOGLE_TOKEN_KEY
  );

  await env.DB.prepare(`
   INSERT INTO ad_connections(
    user_id,provider,account_id,account_name,
    connection_status,token_reference,
    connected_at,updated_at
   )
   VALUES(?,'google',NULL,'Google Ads','connected',?,
    CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
   ON CONFLICT(user_id,provider) DO UPDATE SET
    account_id=NULL,
    account_name='Google Ads',
    connection_status='connected',
    token_reference=excluded.token_reference,
    connected_at=CURRENT_TIMESTAMP,
    updated_at=CURRENT_TIMESTAMP
  `).bind(user.id,encrypted).run();

  return go("/dashboard.html?google=connected");

 }catch(e){
  console.error("Google Ads callback error:",e);
  return go("/dashboard.html?google=error");
 }
}

async function auth(request,env){
 const token=getCookie(
  request.headers.get("Cookie")||"",
  "localboost_session"
 );

 if(!token)return null;

 const user=await env.DB.prepare(`
  SELECT u.id,s.expires_at
  FROM sessions s
  JOIN users u ON u.id=s.user_id
  WHERE s.token=?
  LIMIT 1
 `).bind(token).first();

 if(!user)return null;

 if(
  user.expires_at &&
  new Date(user.expires_at).getTime()<=Date.now()
 ){
  return null;
 }

 return user;
}

async function encryptToken(value,password){
 const enc=new TextEncoder();

 const hash=await crypto.subtle.digest(
  "SHA-256",
  enc.encode(password)
 );

 const key=await crypto.subtle.importKey(
  "raw",
  hash,
  {name:"AES-GCM"},
  false,
  ["encrypt"]
 );

 const iv=crypto.getRandomValues(new Uint8Array(12));

 const encrypted=await crypto.subtle.encrypt(
  {name:"AES-GCM",iv},
  key,
  enc.encode(value)
 );

 return "v1."+b64(iv)+"."+b64(new Uint8Array(encrypted));
}

function b64(bytes){
 let s="";
 for(const b of bytes)s+=String.fromCharCode(b);
 return btoa(s);
}

function getCookie(header,name){
 const item=header
  .split(";")
  .map(x=>x.trim())
  .find(x=>x.startsWith(name+"="));

 return item
  ? decodeURIComponent(item.slice(name.length+1))
  : "";
}

function go(location){
 return new Response(null,{
  status:302,
  headers:{
   "Location":location,
   "Cache-Control":"no-store"
  }
 });
}
