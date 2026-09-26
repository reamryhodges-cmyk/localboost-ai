function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status,headers:{"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}});
}
function getCookies(request) {
  const out={};
  for(const item of (request.headers.get("Cookie")||"").split(";")) {
    const i=item.indexOf("="); if(i>0) out[item.slice(0,i).trim()]=item.slice(i+1).trim();
  }
  return out;
}
export async function onRequestPost(context) {
  const {request,env}=context;
  try {
    if(!env.DB||!env.AI) return json({error:"AI Manager is temporarily unavailable."},500);
    const token=getCookies(request).localboost_session;
    if(!token) return json({error:"Please log in."},401);
    const user=await env.DB.prepare(`
      SELECT s.user_id,s.expires_at,u.plan,u.business_name FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token=? LIMIT 1
    `).bind(token).first();
    if(!user||new Date(user.expires_at).getTime()<=Date.now()) return json({error:"Your login session has expired."},401);
    const paid=String(user.plan||"free").toLowerCase().replace("growth","business");
    if(!["starter","business","pro"].includes(paid)) return json({error:"An active paid plan is required for AI Manager."},403);
    const p=await env.DB.prepare(`
      SELECT business_name,business_type,description,primary_service,other_services,town_city,
      service_area,default_offer,default_call_to_action,target_customer,brand_tone
      FROM business_profiles WHERE user_id=? LIMIT 1
    `).bind(user.user_id).first();
    if(!p||!p.business_type||!p.primary_service||!(p.town_city||p.service_area)) {
      return json({error:"Complete your business type, main service and location in Business Profile first."},400);
    }
    const prompt=`You are the marketing manager for a UK local business.
Create a practical 3-post marketing queue using only supplied facts.
Vary the purpose: one service/value post, one trust/education post, and one direct-response post.
Do not invent prices, offers, awards, guarantees, urgency, testimonials, current events or business facts.
Return ONLY valid JSON in this exact shape:
{"campaigns":[{"service":"","angle":"","extraDetails":""},{"service":"","angle":"","extraDetails":""},{"service":"","angle":"","extraDetails":""}]}
Business: ${p.business_name||user.business_name}
Type: ${p.business_type}
Description: ${p.description||"Not provided"}
Main service: ${p.primary_service}
Other services: ${p.other_services||"Not provided"}
Location: ${p.town_city||p.service_area}
Default offer: ${p.default_offer||"No offer provided"}
Call to action: ${p.default_call_to_action||"Contact us today"}
Ideal customer: ${p.target_customer||"Not provided"}
Tone: ${p.brand_tone||"professional"}
Use a real supplied service. Make the angle useful and specific without inventing facts.`;
    const result=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast",{
      messages:[{role:"system",content:"You are LocalBoost AI Manager. Output strict JSON only."},{role:"user",content:prompt}],max_tokens:350
    });
    const raw=result?.response||result?.result?.response||result?.text||"";
    let data;
    try { const m=raw.match(/\{[\s\S]*\}/); data=JSON.parse(m?m[0]:raw); }
    catch { return json({error:"AI Manager could not prepare a campaign. Please try again."},502); }
    const rawCampaigns=Array.isArray(data.campaigns)?data.campaigns.slice(0,3):[data];
    const campaigns=rawCampaigns.map(item=>({
      businessName:p.business_name||user.business_name,
      businessType:p.business_type,
      location:p.town_city||p.service_area,
      service:String(item?.service||p.primary_service).slice(0,200),
      angle:String(item?.angle||"").slice(0,500),
      extraDetails:String(item?.extraDetails||"").slice(0,1000)
    }));
    return json({success:true,campaign:campaigns[0],campaigns});
  } catch(error) {
    console.error("AI Manager error:",error);
    return json({error:"AI Manager could not prepare the next campaign."},500);
  }
}