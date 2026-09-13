export async function onRequestGet({request,env}){
 try{
  const u=await auth(request,env);
  if(!u)return json({success:false,error:"Please log in."},401);

  const r=await env.DB.prepare(`
   SELECT provider,account_id,account_name,connection_status,connected_at
   FROM ad_connections WHERE user_id=?
  `).bind(u.id).all();

  const out={
   meta:{status:"not_connected",accountName:""},
   google:{status:"not_connected",accountName:""}
  };

  for(const x of (r.results||[])){
   if(x.provider==="meta")out.meta={
    status:x.connection_status||"not_connected",
    accountName:x.account_name||""
   };
   if(x.provider==="google")out.google={
    status:x.connection_status||"not_connected",
    accountName:x.account_name||""
   };
  }

  return json({success:true,connections:out});
 }catch(e){
  console.error("Ad connection error:",e);
  return json({success:false,error:"Could not load advertising connections."},500);
 }
}

async function auth(request,env){
 const t=cookie(request.headers.get("Cookie")||"","localboost_session");
 if(!t)return null;

 const u=await env.DB.prepare(`
  SELECT u.id,s.expires_at
  FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.token=? LIMIT 1
 `).bind(t).first();

 if(!u)return null;
 if(u.expires_at&&new Date(u.expires_at).getTime()<=Date.now())return null;
 return u;
}

function cookie(h,n){
 const p=h.split(";").map(x=>x.trim()).find(x=>x.startsWith(n+"="));
 return p?decodeURIComponent(p.slice(n.length+1)):"";
}

function json(d,s=200){
 return new Response(JSON.stringify(d),{
  status:s,
  headers:{
   "Content-Type":"application/json; charset=UTF-8",
   "Cache-Control":"no-store"
  }
 });
}
