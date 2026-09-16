const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_BATCH_SIZE = 10;
const MIN_CONFIDENCE = 70;

const BUSINESS_TYPES = [
  "Car Valeting",
  "Plumbers",
  "Electricians",
  "Hair Salons",
  "Beauty Salons",
  "Landscaping"
];

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json(
        {
          success: false,
          error: "Database is not configured."
        },
        500
      );
    }

    if (!env.OUTREACH_AUTOMATION_KEY) {
      return json(
        {
          success: false,
          error: "Automation key is not configured."
        },
        500
      );
    }

    const suppliedKey =
      request.headers.get("X-Automation-Key") || "";

    if (
      !suppliedKey ||
      !safeEqual(
        suppliedKey,
        env.OUTREACH_AUTOMATION_KEY
      )
    ) {
      return json(
        {
          success: false,
          error: "Unauthorised automation request."
        },
        401
      );
    }

    const settings = await env.DB.prepare(`
      SELECT
        id,
        enabled,
        daily_limit,
        batch_size,
        business_type,
        last_run_at
      FROM outreach_automation
      ORDER BY id ASC
      LIMIT 1
    `).first();

    if (!settings) {
      return json(
        {
          success: false,
          error: "Automation settings were not found."
        },
        500
      );
    }

    if (Number(settings.enabled) !== 1) {
      return json({
        success: true,
        ran: false,
        reason: "automation_disabled",
        message: "AI outreach automation is switched off."
      });
    }

    const dailyLimit = clampInteger(
      settings.daily_limit,
      1,
      DEFAULT_DAILY_LIMIT,
      DEFAULT_DAILY_LIMIT
    );

    const batchSize = clampInteger(
      settings.batch_size,
      1,
      DEFAULT_BATCH_SIZE,
      DEFAULT_BATCH_SIZE
    );

    const sentToday = await getSentToday(env);

    if (sentToday >= dailyLimit) {
      return json({
        success: true,
        ran: false,
        reason: "daily_limit_reached",
        sentToday,
        dailyLimit,
        remainingToday: 0
      });
    }

    const remainingToday =
      dailyLimit - sentToday;

    const allowedBatchSize =
      Math.min(
        batchSize,
        remainingToday,
        DEFAULT_BATCH_SIZE
      );

    const requestedType =
      clean(settings.business_type, 100) || "mixed";

    const businessType =
      chooseBusinessType(
        requestedType,
        settings.last_run_at
      );

    const candidates =
      await findBusinesses(
        env,
        businessType
      );

    if (!candidates.length) {
      await updateLastRun(env);

      return json({
        success: true,
        ran: true,
        businessType,
        found: 0,
        prepared: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        sentToday,
        dailyLimit,
        remainingToday,
        message:
          "No suitable new businesses were found."
      });
    }

    const prepared =
      await prepareBusinesses(
        env,
        candidates,
        allowedBatchSize
      );

    if (!prepared.length) {
      await updateLastRun(env);

      return json({
        success: true,
        ran: true,
        businessType,
        found: candidates.length,
        prepared: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        sentToday,
        dailyLimit,
        remainingToday,
        message:
          "No businesses passed the email preparation checks."
      });
    }

    const result =
      await sendBusinesses(
        env,
        prepared,
        allowedBatchSize
      );

    await updateLastRun(env);

    const finalSentToday =
      sentToday + result.sent;

    return json({
      success: true,
      ran: true,
      businessType,
      found: candidates.length,
      prepared: prepared.length,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      sentToday: finalSentToday,
      dailyLimit,
      remainingToday:
        Math.max(
          0,
          dailyLimit - finalSentToday
        ),
      message:
        `AI outreach completed. ${result.sent} email` +
        `${result.sent === 1 ? "" : "s"} sent.`
    });
  } catch (error) {
    console.error(
      "Automated outreach error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Automated outreach could not complete."
      },
      500
    );
  }
}

async function findBusinesses(
  env,
  businessType
) {
  if (!env.HUNTER_API_KEY) {
    throw new Error(
      "Hunter API key is not configured."
    );
  }

  const body = {
    headquarter_location: {
      country: "GB"
    },
    headcount: [
      "1-10",
      "11-50"
    ],
    limit: 30
  };

  if (
    businessType &&
    businessType !== "mixed"
  ) {
    body.query = businessType;
  }

  const response = await fetch(
    "https://api.hunter.io/v2/discover",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${env.HUNTER_API_KEY}`,
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await safeJson(response);

  if (!response.ok) {
    console.error(
      "Hunter discover error:",
      data
    );

    throw new Error(
      "Business discovery failed."
    );
  }

  const companies =
    data?.data?.companies ||
    data?.data ||
    [];

  if (!Array.isArray(companies)) {
    return [];
  }

  const output = [];

  for (const company of companies) {
    const domain =
      cleanDomain(
        company?.domain ||
        company?.website ||
        company?.organization?.domain
      );

    const businessName =
      clean(
        company?.name ||
        company?.organization?.name,
        200
      );

    if (
      !businessName ||
      !domain ||
      !isUkDomain(domain) ||
      isBlockedDomain(domain)
    ) {
      continue;
    }

    if (
      await prospectExists(
        env,
        businessName,
        domain
      )
    ) {
      continue;
    }

    output.push({
      businessName,
      businessType:
        businessType === "mixed"
          ? clean(
              company?.industry ||
              company?.category ||
              "UK business",
              100
            )
          : businessType,
      location:
        clean(
          company?.city ||
          company?.location ||
          "United Kingdom",
          150
        ),
      domain,
      ukVerified: true
    });

    if (output.length >= 20) {
      break;
    }
  }

  return output;
}

async function prepareBusinesses(
  env,
  businesses,
  limit
) {
  const prepared = [];

  for (const business of businesses) {
    if (prepared.length >= limit) {
      break;
    }

    const email =
      await findGenericEmail(
        env,
        business.domain
      );

    if (!email) {
      continue;
    }

    if (
      await isSuppressed(
        env,
        email.email
      )
    ) {
      continue;
    }

    if (
      await emailAlreadyContacted(
        env,
        email.email
      )
    ) {
      continue;
    }

    prepared.push({
      ...business,
      email: email.email,
      confidence: email.confidence,
      emailType: "generic",
      status: "ready"
    });
  }

  return prepared;
}

async function findGenericEmail(
  env,
  domain
) {
  const url =
    "https://api.hunter.io/v2/domain-search" +
    `?domain=${encodeURIComponent(domain)}` +
    "&type=generic" +
    `&api_key=${encodeURIComponent(env.HUNTER_API_KEY)}`;

  const response =
    await fetch(url);

  const data =
    await safeJson(response);

  if (!response.ok) {
    console.error(
      "Hunter email lookup failed:",
      domain,
      data
    );

    return null;
  }

  const emails =
    Array.isArray(data?.data?.emails)
      ? data.data.emails
      : [];

  const valid =
    emails
      .filter(item => {
        const email =
          normalizeEmail(item?.value);

        const confidence =
          Number(item?.confidence || 0);

        const type =
          String(item?.type || "")
            .toLowerCase();

        return (
          email &&
          type === "generic" &&
          confidence >= MIN_CONFIDENCE &&
          emailMatchesDomain(
            email,
            domain
          )
        );
      })
      .sort(
        (a, b) =>
          Number(b?.confidence || 0) -
          Number(a?.confidence || 0)
      );

  if (!valid.length) {
    return null;
  }

  return {
    email:
      normalizeEmail(
        valid[0].value
      ),
    confidence:
      Number(
        valid[0].confidence || 0
      )
  };
}

async function sendBusinesses(
  env,
  businesses,
  limit
) {
  if (!env.RESEND_API_KEY) {
    throw new Error(
      "Resend API key is not configured."
    );
  }

  if (!env.UNSUBSCRIBE_SECRET) {
    throw new Error(
      "Unsubscribe secret is not configured."
    );
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (
    const business
    of businesses.slice(0, limit)
  ) {
    const email =
      normalizeEmail(
        business.email
      );

    const domain =
      cleanDomain(
        business.domain
      );

    if (
      !email ||
      !domain ||
      !isUkDomain(domain) ||
      !emailMatchesDomain(
        email,
        domain
      ) ||
      Number(
        business.confidence || 0
      ) < MIN_CONFIDENCE
    ) {
      skipped++;
      continue;
    }

    if (
      await isSuppressed(
        env,
        email
      )
    ) {
      skipped++;
      continue;
    }

    if (
      await emailAlreadyContacted(
        env,
        email
      )
    ) {
      skipped++;
      continue;
    }

    const content =
      await createEmailContent(
        env,
        business
      );

    const token =
      await createUnsubscribeToken(
        email,
        env.UNSUBSCRIBE_SECRET
      );

    const unsubscribeUrl =
      "https://localboost4u.co.uk/unsubscribe" +
      `?email=${encodeURIComponent(email)}` +
      `&token=${encodeURIComponent(token)}`;

    const text =
      `${content.text}\n\n` +
      "If you would rather not receive emails " +
      "from LocalBoost AI, unsubscribe here:\n" +
      unsubscribeUrl;

    const html =
      content.html +
      `<p style="margin-top:24px;font-size:12px;">` +
      `If you would rather not receive emails from ` +
      `LocalBoost AI, ` +
      `<a href="${escapeHtml(unsubscribeUrl)}">` +
      `unsubscribe here</a>.</p>`;

    let response;
    let responseData;

    try {
      response = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            from:
              "LocalBoost AI <hello@localboost4u.co.uk>",
            to: [email],
            reply_to:
              "support@localboost4u.co.uk",
            subject:
              content.subject,
            text,
            html,
            headers: {
              "List-Unsubscribe":
                `<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post":
                "List-Unsubscribe=One-Click"
            }
          })
        }
      );

      responseData =
        await safeJson(response);
    } catch (error) {
      console.error(
        "Resend request failed:",
        error
      );

      failed++;
      continue;
    }

    if (!response.ok) {
      console.error(
        "Resend rejected email:",
        responseData
      );

      failed++;
      continue;
    }

    try {
      await env.DB.prepare(`
        INSERT INTO prospects (
          business_name,
          business_type,
          location,
          contact_method,
          contact_details,
          status,
          approached_at
        )
        VALUES (
          ?, ?, ?, 'email', ?, 'contacted',
          CURRENT_TIMESTAMP
        )
      `)
        .bind(
          business.businessName,
          business.businessType || null,
          business.location || null,
          email
        )
        .run();
    } catch (error) {
      console.error(
        "Prospect record failed after send:",
        error
      );
    }

    sent++;
  }

  return {
    sent,
    skipped,
    failed
  };
}

async function createEmailContent(
  env,
  business
) {
  const fallback =
    fallbackEmail(
      business.businessName
    );

  if (!env.AI) {
    return fallback;
  }

  try {
    const prompt = `
Write a short professional UK business outreach email.

Business:
${business.businessName}

Business type:
${business.businessType || "UK small business"}

Location:
${business.location || "United Kingdom"}

Introduce LocalBoost AI as a service that helps local
businesses create social media marketing content using AI.

Rules:
- British English.
- Friendly and professional.
- Maximum 120 words.
- No fake claims.
- No fake personalisation.
- No urgency or pressure.
- Do not claim we reviewed their website.
- Mention https://localboost4u.co.uk
- Return JSON only with:
  subject
  text
`.trim();

    const result =
      await env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct-fast",
        {
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        }
      );

    const raw =
      result?.response ||
      result?.result?.response ||
      "";

    const parsed =
      parseAiJson(raw);

    if (
      !parsed?.subject ||
      !parsed?.text
    ) {
      return fallback;
    }

    const subject =
      clean(parsed.subject, 150);

    const text =
      clean(parsed.text, 2000);

    return {
      subject,
      text,
      html:
        `<div style="font-family:Arial,sans-serif;` +
        `line-height:1.6;">` +
        `${escapeHtml(text).replace(/\n/g, "<br>")}` +
        `</div>`
    };
  } catch (error) {
    console.error(
      "AI email generation failed:",
      error
    );

    return fallback;
  }
}

function fallbackEmail(
  businessName
) {
  const name =
    clean(
      businessName,
      200
    ) || "your business";

  const subject =
    `A simple marketing idea for ${name}`;

  const text =
    `Hi ${name},\n\n` +
    `I'm getting in touch from LocalBoost AI. ` +
    `We help local businesses create professional ` +
    `social media marketing content using AI, ` +
    `without needing to spend hours planning posts.\n\n` +
    `You can see how it works at ` +
    `https://localboost4u.co.uk\n\n` +
    `Kind regards,\nLocalBoost AI`;

  return {
    subject,
    text,
    html:
      `<div style="font-family:Arial,sans-serif;` +
      `line-height:1.6;">` +
      `${escapeHtml(text).replace(/\n/g, "<br>")}` +
      `</div>`
  };
}

async function getSentToday(
  env
) {
  const row =
    await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM prospects
      WHERE
        LOWER(contact_method) = 'email'
      AND
        DATE(approached_at) = DATE('now')
    `).first();

  return Number(
    row?.total || 0
  );
}

async function prospectExists(
  env,
  businessName,
  domain
) {
  try {
    const row =
      await env.DB.prepare(`
        SELECT id
        FROM prospects
        WHERE
          LOWER(business_name) = LOWER(?)
        OR
          LOWER(contact_details) LIKE ?
        LIMIT 1
      `)
        .bind(
          businessName,
          `%${domain}%`
        )
        .first();

    return !!row;
  } catch (error) {
    console.error(
      "Prospect duplicate check failed:",
      error
    );

    return true;
  }
}

async function emailAlreadyContacted(
  env,
  email
) {
  try {
    const row =
      await env.DB.prepare(`
        SELECT id
        FROM prospects
        WHERE
          LOWER(contact_details) = LOWER(?)
        LIMIT 1
      `)
        .bind(email)
        .first();

    return !!row;
  } catch (error) {
    console.error(
      "Email duplicate check failed:",
      error
    );

    return true;
  }
}

async function isSuppressed(
  env,
  email
) {
  try {
    const row =
      await env.DB.prepare(`
        SELECT email
        FROM suppression_list
        WHERE LOWER(email) = LOWER(?)
        LIMIT 1
      `)
        .bind(email)
        .first();

    return !!row;
  } catch (error) {
    console.error(
      "Suppression check failed:",
      error
    );

    return true;
  }
}

async function updateLastRun(
  env
) {
  await env.DB.prepare(`
    UPDATE outreach_automation
    SET
      last_run_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT id
      FROM outreach_automation
      ORDER BY id ASC
      LIMIT 1
    )
  `).run();
}

function chooseBusinessType(
  requestedType,
  lastRunAt
) {
  if (
    requestedType &&
    requestedType.toLowerCase() !==
      "mixed"
  ) {
    const match =
      BUSINESS_TYPES.find(
        type =>
          type.toLowerCase() ===
          requestedType.toLowerCase()
      );

    return match || "Car Valeting";
  }

  let index = 0;

  if (lastRunAt) {
    const day =
      Math.floor(
        new Date(lastRunAt).getTime() /
        86400000
      );

    if (Number.isFinite(day)) {
      index =
        (day + 1) %
        BUSINESS_TYPES.length;
    }
  } else {
    index =
      Math.floor(
        Date.now() / 86400000
      ) %
      BUSINESS_TYPES.length;
  }

  return BUSINESS_TYPES[index];
}

function parseAiJson(
  value
) {
  try {
    const cleaned =
      String(value || "")
        .trim()
        .replace(/^```json/i, "")
        .replace(/^```/, "")
        .replace(/```$/, "")
        .trim();

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function createUnsubscribeToken(
  email,
  secret
) {
  const encoder =
    new TextEncoder();

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        email.toLowerCase()
      )
    );

  return bytesToHex(
    new Uint8Array(signature)
  );
}

function safeEqual(
  a,
  b
) {
  const left =
    new TextEncoder().encode(
      String(a)
    );

  const right =
    new TextEncoder().encode(
      String(b)
    );

  if (
    left.length !==
    right.length
  ) {
    return false;
  }

  let difference = 0;

  for (
    let i = 0;
    i < left.length;
    i++
  ) {
    difference |=
      left[i] ^ right[i];
  }

  return difference === 0;
}

function bytesToHex(
  bytes
) {
  return Array.from(bytes)
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}

function cleanDomain(
  value
) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0];
}

function normalizeEmail(
  value
) {
  const email =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  ) {
    return "";
  }

  return email;
}

function emailMatchesDomain(
  email,
  domain
) {
  const emailDomain =
    String(email)
      .split("@")[1]
      ?.toLowerCase();

  return (
    emailDomain === domain ||
    emailDomain?.endsWith(
      `.${domain}`
    )
  );
}

function isUkDomain(
  domain
) {
  return (
    domain.endsWith(".co.uk") ||
    domain.endsWith(".org.uk") ||
    domain.endsWith(".me.uk") ||
    domain.endsWith(".ltd.uk") ||
    domain.endsWith(".plc.uk") ||
    domain.endsWith(".net.uk") ||
    domain.endsWith(".uk")
  );
}

function isBlockedDomain(
  domain
) {
  const blocked = [
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "youtube.com",
    "yell.com",
    "yelp.com",
    "checkatrade.com",
    "trustatrader.com",
    "ratedpeople.com",
    "mybuilder.com",
    "bark.com",
    "amazon.co.uk",
    "amazon.com",
    "ebay.co.uk",
    "ebay.com",
    "booking.com",
    "tripadvisor.co.uk",
    "tripadvisor.com"
  ];

  return blocked.some(
    item =>
      domain === item ||
      domain.endsWith(
        `.${item}`
      )
  );
}

function clean(
  value,
  maxLength
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function clampInteger(
  value,
  min,
  max,
  fallback
) {
  const number =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(number)
  ) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      number
    )
  );
}

async function safeJson(
  response
) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function escapeHtml(
  value
) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
        }
