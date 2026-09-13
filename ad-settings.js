const PAID_PLANS=["starter","business","pro"];

export async function onRequestGet({request,env}){
 try{
  const u=await auth(request,env);
  if(!u)return json({success:false,error:"Please log in."},401);

  const s=await env.DB.prepare(`
   SELECT facebook_instagram,google_ads,youtube_ads,objective,service,
   target_location,radius_miles,daily_budget,call_to_action,
   approval_required,status
   FROM ad_settings WHERE user_id=? LIMIT 1
  `).bind(u.id).first();

  return json({
   success:true,
   settings:s||{
    facebook_instagram:0,google_ads:0,youtube_ads:0,
    objective:"",service:"",target_location:"",
    radius_miles:15,daily_budget:null,
    call_to_action:"Contact us today",
    approval_required:1,status:"setup"
   }
  });
 }catch(e){
  console.error(e);
  return json({success:false,error:"Could not load advertising settings."},500);
 }
}

export async function onRequestPost({request,env}){
 try{
  const u=await auth(request,env);
  if(!u)return json({success:false,error:"Please log in."},401);

  if(!PAID_PLANS.includes(String(u.plan||"").toLowerCase())){
   return json({
    success:false,
    error:"A paid LocalBoost plan is required for advertising."
   },403);
  }

  let b={};
  try{b=await request.json()}catch(e){}

  const fb=b.facebookInstagram?1:0;
  const google=b.googleAds?1:0;
  const youtube=b.youtubeAds?1:0;

  if(!fb&&!google&&!youtube){
   return json({
    success:false,
    error:"Choose at least one advertising platform."
   },400);
  }

  const objective=clean(b.objective,80);
  const service=clean(b.service,250);
  const location=clean(b.targetLocation,150);
  const cta=clean(b.callToAction||"Contact us today",100);

  const radius=Math.max(1,Math.min(100,Number(b.radiusMiles)||15));
  const budget=Number(b.dailyBudget);

  if(!service||!location){
   return json({
    success:false,
    error:"Service and target location are required."
   },400);
  }

  if(!Number.isFinite(budget)||budget<1||budget>10000){
   return json({
    success:false,
    error:"Enter a valid daily advertising budget."
   },400);
  }

  await env.DB.prepare(`
   INSERT INTO ad_settings(
    user_id,facebook_instagram,google_ads,youtube_ads,
    objective,service,target_location,radius_miles,
    daily_budget,call_to_action,approval_required,status,updated_at
   )
   VALUES(?,?,?,?,?,?,?,?,?,?,1,'ready_for_connection',CURRENT_TIMESTAMP)
   ON CONFLICT(user_id) DO UPDATE SET
    facebook_instagram=excluded.facebook_instagram,
    google_ads=excluded.google_ads,
    youtube_ads=excluded.youtube_ads,
    objective=excluded.objective,
    service=excluded.service,
    target_location=excluded.target_location,
    radius_miles=excluded.radius_miles,
    daily_budget=excluded.daily_budget,
    call_to_action=excluded.call_to_action,
    approval_required=1,
    status='ready_for_connection',
    updated_at=CURRENT_TIMESTAMP
  `).bind(
   u.id,fb,google,youtube,objective,service,
   location,radius,budget,cta
  ).run();

  return json({
   success:true,
   message:"Advertising setup saved. No adverts were launched and no money was spent."
  });

 }catch(e){
  console.error(e);
  return json({success:false,error:"Could not save advertising settings."},500);
 }
}

async function auth(request,env){
 const token=cookie(request.headers.get("Cookie")||"","localboost_session");
 if(!token)return null;

 const u=await env.DB.prepare(`
  SELECT u.id,u.email,u.plan,s.expires_at
  FROM sessions s
  JOIN users u ON u.id=s.user_id
  WHERE s.token=?
  LIMIT 1
 `).bind(token).first();

 if(!u)return null;

 if(u.expires_at&&new Date(u.expires_at).getTime()<=Date.now()){
  return null;
 }

 return u;
}

function clean(v,n){
 return String(v||"").trim().slice(0,n);
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
