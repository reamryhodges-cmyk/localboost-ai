function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}});}
function token(request){const h=request.headers.get("Cookie")||"";for(const x of h.split(";")){const i=x.indexOf("=");if(i>0&&x.slice(0,i).trim()==="localboost_session")return x.slice(i+1).trim();}return "";}
async function userFor(request,env){
 const t=token(request); if(!t)return null;
 const u=await env.DB.prepare(`SELECT s.user_id,s.expires_at,u.plan FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? LIMIT 1`).bind(t).first();
 if(!u||new Date(u.expires_at).getTime()<=Date.now())return null; return u;
}
export async function onRequest(context){
 const {request,env}=context;
 try{
  if(!env.DB)return json({error:"Database is not configured."},500);
  const user=await userFor(request,env); if(!user)return json({error:"Please log in."},401);
  if(request.method==="GET"){
   const rows=await env.DB.prepare(`SELECT id,caption,image_data,status,scheduled_for,created_at FROM content_queue WHERE user_id=? ORDER BY id DESC LIMIT 20`).bind(user.user_id).all();
   return json({items:rows.results||[]});
  }
  if(request.method==="POST"){
   const paid=String(user.plan||"free").toLowerCase().replace("growth","business");
   if(!["starter","business","pro"].includes(paid))return json({error:"An active paid plan is required."},403);
   const b=await request.json();
   const caption=String(b.caption||"").trim().slice(0,5000);
   const image=String(b.image||"").trim();
   const scheduledFor=String(b.scheduledFor||"").trim();
   if(!caption)return json({error:"There is no generated caption to approve."},400);
   if(scheduledFor&&Number.isNaN(new Date(scheduledFor).getTime()))return json({error:"Choose a valid schedule time."},400);
   await env.DB.prepare(`CREATE TABLE IF NOT EXISTS content_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,caption TEXT NOT NULL,image_data TEXT,
    status TEXT NOT NULL DEFAULT 'approved',scheduled_for TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`).run();
   const r=await env.DB.prepare(`INSERT INTO content_queue(user_id,caption,image_data,status,scheduled_for) VALUES(?,?,?, ?,?)`)
    .bind(user.user_id,caption,image.slice(0,2000000),scheduledFor?"scheduled":"approved",scheduledFor||null).run();
   return json({success:true,id:r.meta?.last_row_id||null,status:scheduledFor?"scheduled":"approved"});
  }
  return json({error:"Method not allowed."},405);
 }catch(e){console.error("Content queue error:",e);return json({error:"Content could not be saved to the approval queue."},500);}
}