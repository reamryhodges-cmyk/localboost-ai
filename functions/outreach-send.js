const ADMIN_EMAIL =
  "reamryhodges@gmail.com";

const FROM_EMAIL =
  "LocalBoost AI <hello@localboost4u.co.uk>";

const REPLY_TO_EMAIL =
  "support@localboost4u.co.uk";

const DAILY_LIMIT = 50;
const MAX_BATCH_SIZE = 10;
const MIN_CONFIDENCE = 70;

const AI_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fast";

const SITE_URL =
  "https://localboost4u.co.uk";

const BLOCKED_DOMAINS = [
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
  "etsy.com",
  "amazon.co.uk",
  "amazon.com",
  "ebay.co.uk",
  "ebay.com",
  "booking.com",
  "tripadvisor.co.uk",
  "tripadvisor.com"
];


export async function onRequestPost({
  request,
  env
}) {
  try {
    const auth =
      await requireAdmin(
        request,
        env
      );

    if (!auth.ok) {
      return auth.response;
    }

    if (!env.DB) {
      return json(
        {
          success: false,
          error:
            "Database is not configured."
        },
        500
      );
    }

    if (!env.RESEND_API_KEY) {
      return json(
        {
          success: false,
          error:
            "Email service is not configured."
        },
        500
      );
    }

    if (!env.UNSUBSCRIBE_SECRET) {
      return json(
        {
          success: false,
          error:
            "Unsubscribe service is not configured."
        },
        500
      );
    }

    let body = {};

    try {
      body =
        await request.json();
    } catch {
      return json(
        {
          success: false,
          error:
            "Invalid request."
        },
        400
      );
    }

    let businesses = [];

    if (
      Array.isArray(
        body.businesses
      )
    ) {
      businesses =
        body.businesses.slice(
          0,
          MAX_BATCH_SIZE
        );
    } else {
      businesses = [
        {
          businessName:
            body.businessName,

          businessType:
            body.businessType,

          location:
            body.location,

          domain:
            body.domain,

          email:
            body.email,

          confidence:
            body.confidence,

          ukVerified:
            body.ukVerified,

          qualityScore:
            body.qualityScore
        }
      ];
    }

    if (!businesses.length) {
      return json(
        {
          success: false,
          error:
            "No businesses were provided."
        },
        400
      );
    }

    const dailyCount =
      await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM prospects
        WHERE
          LOWER(contact_method) = 'email'
        AND
          DATE(approached_at) =
          DATE('now')
      `)
        .first();

    let sentToday =
      Number(
        dailyCount?.total || 0
      );

    if (
      sentToday >=
      DAILY_LIMIT
    ) {
      return json(
        {
          success: false,
          error:
            "Daily outreach limit reached.",
          sentToday,
          dailyLimit:
            DAILY_LIMIT,
          remainingToday: 0
        },
        429
      );
    }

    const sent = [];
    const skipped = [];
    const failed = [];

    const seenEmails =
      new Set();

    const seenDomains =
      new Set();

    for (
      const rawBusiness
      of businesses
    ) {
      if (
        sentToday >=
        DAILY_LIMIT
      ) {
        skipped.push({
          businessName:
            clean(
              rawBusiness
                ?.businessName,
              200
            ),

          reason:
            "Daily outreach limit reached."
        });

        continue;
      }

      const businessName =
        clean(
          rawBusiness
            ?.businessName,
          200
        );

      const businessType =
        clean(
          rawBusiness
            ?.businessType,
          200
        );

      const location =
        clean(
          rawBusiness
            ?.location,
          200
        );

      const domain =
        cleanDomain(
          rawBusiness
            ?.domain
        );

      const email =
        normalizeEmail(
          rawBusiness
            ?.email
        );

      const confidence =
        safeNumber(
          rawBusiness
            ?.confidence
        );

      const ukVerified =
        rawBusiness
          ?.ukVerified === true;

      if (!businessName) {
        skipped.push({
          businessName:
            "Unknown business",

          reason:
            "Missing business name."
        });

        continue;
      }

      if (!domain) {
        skipped.push({
          businessName,

          reason:
            "Missing or invalid domain."
        });

        continue;
      }

      if (!isUkDomain(domain)) {
        skipped.push({
          businessName,
          reason:
            "Domain is not a verified UK business domain."
        });

        continue;
      }

      if (
        rawBusiness
          ?.ukVerified !==
          undefined &&
        !ukVerified
      ) {
        skipped.push({
          businessName,
          reason:
            "Business failed UK verification."
        });

        continue;
      }

      if (
        isBlockedDomain(
          domain
        )
      ) {
        skipped.push({
          businessName,
          reason:
            "Directory, marketplace or social domain blocked."
        });

        continue;
      }

      if (!email) {
        skipped.push({
          businessName,
          reason:
            "Missing or invalid email."
        });

        continue;
      }

      if (
        !emailMatchesDomain(
          email,
          domain
        )
      ) {
        skipped.push({
          businessName,
          reason:
            "Email does not match the business domain."
        });

        continue;
      }

      if (
        confidence !== null &&
        confidence <
          MIN_CONFIDENCE
      ) {
        skipped.push({
          businessName,
          reason:
            `Email confidence is below ${MIN_CONFIDENCE}%.`
        });

        continue;
      }

      if (
        seenEmails.has(
          email
        ) ||
        seenDomains.has(
          domain
        )
      ) {
        skipped.push({
          businessName,
          reason:
            "Duplicate business in this batch."
        });

        continue;
      }

      seenEmails.add(
        email
      );

      seenDomains.add(
        domain
      );

      const suppressed =
        await isSuppressed(
          env,
          email
        );

      if (suppressed) {
        skipped.push({
          businessName,
          reason:
            "Email is on the suppression list."
        });

        continue;
      }

      const duplicate =
        await prospectExists(
          env,
          businessName,
          domain,
          email
        );

      if (duplicate) {
        skipped.push({
          businessName,
          reason:
            "Business has already been contacted."
        });

        continue;
      }

      let emailContent;

      try {
        emailContent =
          await createEmailContent(
            env,
            {
              businessName,
              businessType,
              location
            }
          );
      } catch (error) {
        console.error(
          "AI outreach content error:",
          error
        );

        emailContent =
          fallbackEmail(
            businessName
          );
      }

      const unsubscribeToken =
        await createUnsubscribeToken(
          email,
          env.UNSUBSCRIBE_SECRET
        );

      const unsubscribeUrl =
        `${SITE_URL}/unsubscribe?email=` +
        encodeURIComponent(
          email
        ) +
        "&token=" +
        encodeURIComponent(
          unsubscribeToken
        );

      const textBody =
        `${emailContent.text}\n\n` +
        `If you would rather not receive emails from LocalBoost AI, unsubscribe here:\n${unsubscribeUrl}`;

      const htmlBody =
        `${emailContent.html}` +
        `<p style="margin-top:24px;font-size:12px;color:#667085;">` +
        `If you would rather not receive emails from LocalBoost AI, ` +
        `<a href="${escapeHtml(unsubscribeUrl)}">unsubscribe here</a>.` +
        `</p>`;

      let resendResponse;
      let resendData;

      try {
        resendResponse =
          await fetch(
            "https://api.resend.com/emails",
            {
              method: "POST",

              headers: {
                Authorization:
                  `Bearer ${env.RESEND_API_KEY}`,

                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  from:
                    FROM_EMAIL,

                  to: [
                    email
                  ],

                  reply_to:
                    REPLY_TO_EMAIL,

                  subject:
                    emailContent.subject,

                  text:
                    textBody,

                  html:
                    htmlBody,

                  headers: {
                    "List-Unsubscribe":
                      `<${unsubscribeUrl}>`,

                    "List-Unsubscribe-Post":
                      "List-Unsubscribe=One-Click"
                  }
                })
            }
          );

        resendData =
          await resendResponse.json();

      } catch (error) {
        failed.push({
          businessName,
          email,
          reason:
            "Email service request failed."
        });

        continue;
      }

      if (
        !resendResponse.ok
      ) {
        console.error(
          "Resend error:",
          resendData
        );

        failed.push({
          businessName,
          email,
          reason:
            resendData?.message ||
            resendData?.error ||
            "Email was not accepted."
        });

        continue;
      }

      sentToday += 1;

      let recordWarning =
        null;

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
            businessName,
            businessType || null,
            location || null,
            email
          )
          .run();

      } catch (error) {
        console.error(
          "Prospect recording error:",
          error
        );

        recordWarning =
          "Email sent but database record could not be saved.";
      }

      sent.push({
        businessName,
        email,
        domain,
        resendId:
          resendData?.id ||
          null,
        recordWarning
      });
    }

    return json({
      success: true,

      sent,
      skipped,
      failed,

      sentCount:
        sent.length,

      skippedCount:
        skipped.length,

      failedCount:
        failed.length,

      sentToday,

      dailyLimit:
        DAILY_LIMIT,

      remainingToday:
        Math.max(
          0,
          DAILY_LIMIT -
          sentToday
        )
    });

  } catch (error) {
    console.error(
      "Outreach send error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Could not process outreach."
      },
      500
    );
  }
}


async function requireAdmin(
  request,
  env
) {
  if (!env.DB) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Database is not configured."
          },
          500
        )
    };
  }

  const token =
    getCookie(
      request.headers.get(
        "Cookie"
      ) || "",
      "localboost_session"
    );

  if (!token) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Please log in."
          },
          401
        )
    };
  }

  const user =
    await env.DB.prepare(`
      SELECT
        users.id,
        users.email,
        sessions.expires_at
      FROM sessions
      JOIN users
        ON users.id =
        sessions.user_id
      WHERE sessions.token = ?
      LIMIT 1
    `)
      .bind(token)
      .first();

  if (!user) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Invalid session."
          },
          401
        )
    };
  }

  if (
    user.expires_at &&
    new Date(
      user.expires_at
    ).getTime() <=
      Date.now()
  ) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Session expired."
          },
          401
        )
    };
  }

  if (
    String(
      user.email || ""
    )
      .trim()
      .toLowerCase() !==
    ADMIN_EMAIL.toLowerCase()
  ) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Admin access required."
          },
          403
        )
    };
  }

  return {
    ok: true,
    user
  };
}


async function isSuppressed(
  env,
  email
) {
  try {
    const result =
      await env.DB.prepare(`
        SELECT email
        FROM suppression_list
        WHERE LOWER(email) =
        LOWER(?)
        LIMIT 1
      `)
        .bind(email)
        .first();

    return !!result;

  } catch (error) {
    console.error(
      "Suppression check failed:",
      error
    );

    return true;
  }
}


async function prospectExists(
  env,
  businessName,
  domain,
  email
) {
  try {
    const result =
      await env.DB.prepare(`
        SELECT id
        FROM prospects
        WHERE
          LOWER(business_name) =
          LOWER(?)
        OR
          LOWER(contact_details) =
          LOWER(?)
        OR
          LOWER(contact_details)
          LIKE ?
        LIMIT 1
      `)
        .bind(
          businessName,
          email,
          `%${domain}%`
        )
        .first();

    return !!result;

  } catch (error) {
    console.error(
      "Duplicate prospect check failed:",
      error
    );

    return true;
  }
}


async function createEmailContent(
  env,
  business
) {
  if (!env.AI) {
    return fallbackEmail(
      business.businessName
    );
  }

  const prompt = `
Write a short professional cold outreach email from LocalBoost AI to a small UK business.

Business name: ${business.businessName}
Business type: ${business.businessType || "local business"}
Location: ${business.location || "UK"}

LocalBoost AI helps small businesses create professional social media marketing content using AI.

Requirements:
- British English.
- Friendly and professional.
- Do not invent facts about the business.
- Do not claim they have poor marketing.
- No fake urgency.
- No misleading promises.
- Keep the email below 140 words.
- Introduce LocalBoost AI briefly.
- Explain the benefit clearly.
- End with a simple invitation to visit localboost4u.co.uk.
- Do not include an unsubscribe paragraph because the system adds it separately.
`;

  const result =
    await env.AI.run(
      AI_MODEL,
      {
        messages: [
          {
            role:
              "system",

            content:
              "You write concise professional B2B outreach emails for UK small businesses."
          },

          {
            role:
              "user",

            content:
              prompt
          }
        ],

        max_tokens: 350
      }
    );

  const text =
    String(
      result?.response ||
      result?.result
        ?.response ||
      result?.text ||
      ""
    ).trim();

  if (!text) {
    return fallbackEmail(
      business.businessName
    );
  }

  return {
    subject:
      `A quick idea for ${business.businessName}`,

    text,

    html:
      `<p>${escapeHtml(text)
        .replace(
          /\n\n/g,
          "</p><p>"
        )
        .replace(
          /\n/g,
          "<br>"
        )}</p>`
  };
}


function fallbackEmail(
  businessName
) {
  const text =
    `Hi ${businessName},\n\n` +
    `I’m getting in touch from LocalBoost AI. We help local UK businesses create professional social media content quickly using AI.\n\n` +
    `If useful, you can take a look at LocalBoost AI at localboost4u.co.uk.\n\n` +
    `Best regards,\nLocalBoost AI`;

  return {
    subject:
      `A quick idea for ${businessName}`,

    text,

    html:
      `<p>Hi ${escapeHtml(businessName)},</p>` +
      `<p>I’m getting in touch from LocalBoost AI. We help local UK businesses create professional social media content quickly using AI.</p>` +
      `<p>If useful, you can take a look at LocalBoost AI at localboost4u.co.uk.</p>` +
      `<p>Best regards,<br>LocalBoost AI</p>`
  };
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
      [
        "sign"
      ]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        email.toLowerCase()
      )
    );

  return Array
    .from(
      new Uint8Array(
        signature
      )
    )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0"
          )
    )
    .join("");
}


function emailMatchesDomain(
  email,
  domain
) {
  const emailDomain =
    email.split("@")[1] ||
    "";

  return (
    emailDomain ===
      domain ||
    emailDomain.endsWith(
      "." + domain
    ) ||
    domain.endsWith(
      "." + emailDomain
    )
  );
}


function isBlockedDomain(
  domain
) {
  return BLOCKED_DOMAINS.some(
    blocked =>
      domain === blocked ||
      domain.endsWith(
        "." + blocked
      )
  );
}


function isUkDomain(
  domain
) {
  return (
    domain.endsWith(
      ".co.uk"
    ) ||
    domain.endsWith(
      ".org.uk"
    ) ||
    domain.endsWith(
      ".me.uk"
    ) ||
    domain.endsWith(
      ".ltd.uk"
    ) ||
    domain.endsWith(
      ".plc.uk"
    ) ||
    domain.endsWith(
      ".net.uk"
    ) ||
    domain.endsWith(
      ".uk"
    )
  );
}


function cleanDomain(
  value
) {
  let domain =
    String(value || "")
      .trim()
      .toLowerCase();

  domain =
    domain
      .replace(
        /^https?:\/\//,
        ""
      )
      .replace(
        /^www\./,
        ""
      )
      .split("/")[0]
      .split("?")[0]
      .split("#")[0];

  if (
    !domain ||
    !domain.includes(".")
  ) {
    return "";
  }

  return domain;
}


function normalizeEmail(
  value
) {
  const email =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(email)
  ) {
    return "";
  }

  return email.slice(
    0,
    320
  );
}


function safeNumber(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function clean(
  value,
  maxLength
) {
  return String(
    value || ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );
}


function getCookie(
  header,
  name
) {
  const item =
    String(header || "")
      .split(";")
      .map(
        value =>
          value.trim()
      )
      .find(
        value =>
          value.startsWith(
            name + "="
          )
      );

  return item
    ? decodeURIComponent(
        item.slice(
          name.length + 1
        )
      )
    : "";
}


function escapeHtml(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
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
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}
