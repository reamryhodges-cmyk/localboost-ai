const ADMIN_EMAIL="samtest1109@example.com";
const FROM_EMAIL="LocalBoost AI <hello@localboost4u.co.uk>";
const REPLY_TO_EMAIL="support@localboost4u.co.uk";
const DAILY_LIMIT=100;
const MAX_BATCH_SIZE=10;
const AI_MODEL="@cf/meta/llama-3.1-8b-instruct-fast";
const SITE_URL="https://localboost4u.co.uk";

export async function onRequestPost({request,env}){
  try{
    const token=getCookie(request.headers.get("Cookie")||"","localboost_session");
    if(!token)return json({success:false,error:"Please log in."},401);

    const session=await env.DB.prepare(`
      SELECT s.expires_at,u.email
      FROM sessions s
      JOIN users u ON u.id=s.user_id
      WHERE s.token=?
      LIMIT 1
    `).bind(token).first();

    if(!session)return json({success:false,error:"Invalid session."},401);
    if(session.expires_at&&new Date(session.expires_at).getTime()<=Date.now())
      return json({success:false,error:"Session expired. Please log in again."},401);

    if(String(session.email||"").trim().toLowerCase()!==ADMIN_EMAIL)
      return json({success:false,error:"Admin access only."},403);

    if(!env.RESEND_API_KEY)
      return json({success:false,error:"Email service is not configured."},500);

    if(!env.UNSUBSCRIBE_SECRET)
      return json({success:false,error:"Unsubscribe service is not configured."},500);

    let body={};
    try{body=await request.json();}
    catch{return json({success:false,error:"Invalid request."},400);}

    let businesses=[];
    if(Array.isArray(body.businesses)){
      businesses=body.businesses.slice(0,MAX_BATCH_SIZE);
    }else{
      businesses=[{
        businessName:body.businessName,
        businessType:body.businessType,
        location:body.location,
        domain:body.domain,
        email:body.email
      }];
    }

    if(!businesses.length)
      return json({success:false,error:"No businesses were provided."},400);

    const dailyCount=await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM prospects
      WHERE LOWER(contact_method)='email'
      AND approached_at>=datetime('now','-1 day')
    `).first();

    let sentToday=Number(dailyCount?.total||0);

    if(sentToday>=DAILY_LIMIT)
      return json({
        success:false,
        error:"Daily outreach limit reached.",
        sentToday,
        dailyLimit:DAILY_LIMIT
      },429);

    const sent=[];
    const skipped=[];
    const failed=[];

    for(const rawBusiness of businesses){
      if(sentToday>=DAILY_LIMIT){
        skipped.push({
          businessName:clean(rawBusiness?.businessName,200),
          reason:"Daily outreach limit reached."
        });
        continue;
      }

      const businessName=clean(rawBusiness?.businessName,200);
      const businessType=clean(rawBusiness?.businessType,200);
      const location=clean(rawBusiness?.location,200);
      const domain=cleanDomain(rawBusiness?.domain);
      const email=clean(rawBusiness?.email,320).toLowerCase();

      if(!businessName){
        skipped.push({businessName:"Unknown business",reason:"Missing business name."});
        continue;
      }

      if(!isValidEmail(email)){
        skipped.push({businessName,reason:"Invalid email address."});
        continue;
      }

      const suppression=await env.DB.prepare(`
        SELECT reason,source
        FROM suppression_list
        WHERE LOWER(email)=LOWER(?)
        LIMIT 1
      `).bind(email).first();

      if(suppression){
        skipped.push({
          businessName,
          email,
          reason:"Email is on the suppression list."
        });
        continue;
      }

      const existing=await env.DB.prepare(`
        SELECT id
        FROM prospects
        WHERE LOWER(contact_method)='email'
        AND LOWER(contact_details)=LOWER(?)
        LIMIT 1
      `).bind(email).first();

      if(existing){
        skipped.push({businessName,email,reason:"Already approached."});
        continue;
      }

      let emailCopy;
      try{
        emailCopy=await createAIEmail({
          env,businessName,businessType,location,domain
        });
      }catch(error){
        console.error("AI outreach generation failed:",businessName,error);
        emailCopy=fallbackEmail({businessName,businessType,location});
      }

      const subject=clean(
        emailCopy?.subject||`A quick idea for ${businessName}`,
        150
      );

      let unsubscribeUrl;
      try{
        unsubscribeUrl=await createUnsubscribeUrl(email,env.UNSUBSCRIBE_SECRET);
      }catch(error){
        console.error("Could not create unsubscribe link:",businessName,error);
        failed.push({
          businessName,
          email,
          error:"Could not create unsubscribe link."
        });
        continue;
      }

      const html=buildEmailHtml({
        businessName,
        message:emailCopy?.message||fallbackEmail({
          businessName,businessType,location
        }).message,
        unsubscribeUrl
      });

      let resendResponse;
      let resendData;

      try{
        resendResponse=await fetch("https://api.resend.com/emails",{
          method:"POST",
          headers:{
            Authorization:`Bearer ${env.RESEND_API_KEY}`,
            "Content-Type":"application/json"
          },
          body:JSON.stringify({
            from:FROM_EMAIL,
            to:[email],
            subject,
            html,
            reply_to:REPLY_TO_EMAIL,
            headers:{
              "List-Unsubscribe":`<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post":"List-Unsubscribe=One-Click"
            }
          })
        });

        resendData=await resendResponse.json().catch(()=>({}));
      }catch(error){
        console.error("Resend request failed:",businessName,error);
        failed.push({
          businessName,
          email,
          error:"Could not contact Resend."
        });
        continue;
      }

      if(!resendResponse.ok){
        console.error("Resend outreach error:",businessName,resendData);
        failed.push({
          businessName,
          email,
          error:resendData?.message||"Email could not be sent."
        });
        continue;
      }

      const contactDetails=domain?`${email} | ${domain}`:email;

      const result=await env.DB.prepare(`
        INSERT INTO prospects(
          business_name,
          business_type,
          location,
          contact_method,
          contact_details,
          status
        )
        VALUES(?,?,?,'Email',?,'approached')
      `).bind(
        businessName,
        businessType,
        location,
        contactDetails
      ).run();

      sentToday++;

      sent.push({
        businessName,
        email,
        domain,
        emailId:resendData?.id||null,
        prospectId:result?.meta?.last_row_id||null
      });
    }

    return json({
      success:true,
      message:`${sent.length} outreach email${sent.length===1?"":"s"} sent.`,
      requested:businesses.length,
      sentCount:sent.length,
      skippedCount:skipped.length,
      failedCount:failed.length,
      sent,
      skipped,
      failed,
      sentToday,
      dailyLimit:DAILY_LIMIT
    });
  }catch(error){
    console.error("Outreach batch send error:",error);
    return json({
      success:false,
      error:"Could not send outreach emails."
    },500);
  }
}

async function createAIEmail({env,businessName,businessType,location,domain}){
  if(!env.AI)return fallbackEmail({businessName,businessType,location});

  const prompt=`
You are writing a short B2B introduction email for LocalBoost AI.

Recipient business:
Business name: ${businessName}
Business type: ${businessType||"local business"}
Location: ${location||"United Kingdom"}
Website/domain: ${domain||"unknown"}

LocalBoost AI helps small businesses quickly create professional social media captions, promotional posts, ideas and marketing content.

Write a friendly UK-English cold outreach email.

Requirements:
- Maximum about 120 words.
- Natural and professional.
- Do not pretend you personally researched anything that is not provided above.
- Do not make exaggerated claims.
- Do not say the recipient has bad marketing.
- Explain briefly why LocalBoost may be useful.
- Include https://localboost4u.co.uk
- Do not add a greeting.
- Do not add a sign-off.
- Do not use markdown.
- Avoid spammy wording.
- Do not write unsubscribe instructions in the message because an unsubscribe link is automatically added below.

Return ONLY valid JSON:
{"subject":"short subject","message":"email body"}
  `.trim();

  const result=await env.AI.run(AI_MODEL,{
    messages:[
      {
        role:"system",
        content:"Return only valid JSON. Do not include markdown code fences."
      },
      {role:"user",content:prompt}
    ],
    max_tokens:350,
    temperature:0.5
  });

  const raw=String(result?.response||"")
    .trim()
    .replace(/^```json\s*/i,"")
    .replace(/^```\s*/,"")
    .replace(/```$/,"")
    .trim();

  try{
    const parsed=JSON.parse(raw);
    const subject=clean(parsed?.subject,150);
    const message=clean(parsed?.message,2000);
    if(subject&&message)return{subject,message};
  }catch(error){
    console.error("AI email JSON parse error:",raw,error);
  }

  return fallbackEmail({businessName,businessType,location});
}

function fallbackEmail({businessName,businessType,location}){
  let opening=`I came across ${businessName} and wanted to introduce LocalBoost AI.`;

  if(businessType&&location){
    opening=`I came across ${businessName}, a ${businessType} business in ${location}, and wanted to introduce LocalBoost AI.`;
  }

  return{
    subject:`A quick idea for ${businessName}`,
    message:`${opening}

LocalBoost AI helps small businesses create social media captions, promotional posts and content ideas quickly, without having to spend hours putting everything together.

You can take a look here:
https://localboost4u.co.uk`
  };
}

async function createUnsubscribeUrl(email,secret){
  const normalized=String(email||"").trim().toLowerCase();
  if(!isValidEmail(normalized))throw new Error("Invalid email.");

  const encodedEmail=stringToBase64Url(normalized);
  const signature=await createSignature(encodedEmail,secret);
  const token=`${encodedEmail}.${signature}`;

  return `${SITE_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function createSignature(message,secret){
  const encoder=new TextEncoder();

  const key=await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    {name:"HMAC",hash:"SHA-256"},
    false,
    ["sign"]
  );

  const signature=await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(String(message))
  );

  return arrayBufferToBase64Url(signature);
}

function stringToBase64Url(value){
  const bytes=new TextEncoder().encode(String(value));
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g,"-")
    .replace(/\//g,"_")
    .replace(/=+$/g,"");
}

function arrayBufferToBase64Url(buffer){
  const bytes=new Uint8Array(buffer);
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g,"-")
    .replace(/\//g,"_")
    .replace(/=+$/g,"");
}

function buildEmailHtml({businessName,message,unsubscribeUrl}){
  const safeBusiness=escapeHtml(businessName);
  const safeMessage=escapeHtml(message).replace(/\n/g,"<br>");
  const safeUnsubscribeUrl=escapeHtml(unsubscribeUrl);

  return `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:600px;margin:auto">
  <p>Hi ${safeBusiness},</p>
  <p>${safeMessage}</p>
  <p>Kind regards,<br>Sam<br>LocalBoost AI</p>
  <hr style="border:0;border-top:1px solid #ddd;margin:28px 0 16px">
  <p style="font-size:12px;color:#666">
    You are receiving this business introduction from LocalBoost AI.
    If you do not want to receive further outreach from us,
    <a href="${safeUnsubscribeUrl}">unsubscribe here</a>.
  </p>
</div>`.trim();
}

function clean(value,maxLength){
  return String(value||"").trim().slice(0,maxLength);
}

function cleanDomain(value){
  return String(value||"")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//,"")
    .replace(/^www\./,"")
    .replace(/\/.*$/,"")
    .slice(0,255);
}

function isValidEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value){
  return String(value||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function getCookie(header,name){
  const item=header
    .split(";")
    .map(value=>value.trim())
    .find(value=>value.startsWith(name+"="));

  return item?item.slice(name.length+1):"";
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
