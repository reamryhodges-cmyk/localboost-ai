const PAID_PLANS=["starter","business","pro"];
const REDIRECT_URI="https://localboost4u.co.uk/google-ads-callback";
const GOOGLE_SCOPE="https://www.googleapis.com/auth/adwords";

export async function onRequestGet({request,env}){
 try{
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET){
   return json({success:false,error:"Google connection is not configured."},500);
  }

  const user=await auth(request,env);
  if(!user)return redirect("/?google=login_required");

  if(!PAID_PLANS.includes(String(user.plan||"").toLowerCase())){
   return redirect("/dashboard.html?google=paid_plan_required");
  }

  const state=randomState();
  const expires=new Date(Date.now()+10*60*1000).toISOString();

  await env.DB.prepare(`
   DELETE FROM google_oauth_states
   WHERE user_id=? OR expires_at<=?
  `).bind(user.id,new Date().toISOString()).run();

  await env.DB.prepare(`
   INSERT INTO google_oauth_states(user_id,state,expires_at)
   VALUES(?,?,?)
  `).bind(user.id,state,expires).run();

  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id",env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri",REDIRECT_URI);
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope",GOOGLE_SCOPE);
  url.searchParams.set("access_type","offline");
  url.searchParams.set("prompt","consent");
  url.searchParams.set("include_granted_scopes","true");
  url.searchParams.set("state",state);

  return new Response(null,{
   status:302,
   headers:{
    "Location":url.toString(),
    "Cache-Control":"no-store"
   }
  });

 }catch(e){
  console.error("Google Ads connect error:",e);
  return json({
   success:false,
   error:"Could not start the Google Ads connection."
  },500);
 }
}

async function auth(request,env){
 const token=getCookie(
  request.headers.get("Cookie")||"",
  "localboost_session"
 );

 if(!token)return null;

 const user=await env.DB.prepare(`
  SELECT u.id,u.email,u.plan,s.expires_at
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

function randomState(){
 const bytes=new Uint8Array(32);
 crypto.getRandomValues(bytes);

 return Array.from(bytes)
  .map(b=>b.toString(16).padStart(2,"0"))
  .join("");
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

function redirect(location){
 return new Response(null,{
  status:302,
  headers:{
   "Location":location,
   "Cache-Control":"no-store"
  }
 });
}

function json(data,status=200){
 return new Response(JSON.stringify(data),{
  status,
  headers:{
   "Content-Type":"application/json; charset=UTF-8",
   "Cache-Control":"no-store"
  }
 });
}
