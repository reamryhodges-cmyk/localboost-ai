
const ADMIN_EMAIL = "samtest1109@example.com";

const FROM_EMAIL =
  "LocalBoost AI <hello@localboost4u.co.uk>";

const REPLY_TO_EMAIL =
  "support@localboost4u.co.uk";

const DAILY_LIMIT = 20;

export async function onRequestPost({ request, env }) {
  try {
    const token = getCookie(
      request.headers.get("Cookie") || "",
      "localboost_session"
    );

    if (!token) {
      return json(
        {
          success: false,
          error: "Please log in."
        },
        401
      );
    }

    const session = await env.DB.prepare(`
      SELECT
        s.expires_at,
        u.email
      FROM sessions s
      JOIN users u
        ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `)
      .bind(token)
      .first();

    if (!session) {
      return json(
        {
          success: false,
          error: "Invalid session."
        },
        401
      );
    }

    if (
      session.expires_at &&
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      return json(
        {
          success: false,
          error: "Session expired. Please log in again."
        },
        401
      );
    }

    if (
      String(session.email || "")
        .trim()
        .toLowerCase() !== ADMIN_EMAIL
    ) {
      return json(
        {
          success: false,
          error: "Admin access only."
        },
        403
      );
    }

    if (!env.RESEND_API_KEY) {
      return json(
        {
          success: false,
          error: "Email service is not configured."
        },
        500
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          success: false,
          error: "Invalid request."
        },
        400
      );
    }

    const businessName =
      clean(body.businessName, 200);

    const businessType =
      clean(body.businessType, 200);

    const location =
      clean(body.location, 200);

    const email =
      clean(body.email, 320)
        .toLowerCase();

    if (!businessName) {
      return json(
        {
          success: false,
          error: "Business name is required."
        },
        400
      );
    }

    if (!isValidEmail(email)) {
      return json(
        {
          success: false,
          error: "A valid business email is required."
        },
        400
      );
    }

    const existing = await env.DB.prepare(`
      SELECT id
      FROM prospects
      WHERE LOWER(contact_details) = LOWER(?)
        AND LOWER(contact_method) = 'email'
      LIMIT 1
    `)
      .bind(email)
      .first();

    if (existing) {
      return json(
        {
          success: false,
          error:
            "This email address has already been approached."
        },
        409
      );
    }

    const dailyCount = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM prospects
      WHERE LOWER(contact_method) = 'email'
        AND approached_at >= datetime('now', '-1 day')
    `).first();

    const sentToday =
      Number(dailyCount?.total || 0);

    if (sentToday >= DAILY_LIMIT) {
      return json(
        {
          success: false,
          error:
            "Daily outreach limit reached."
        },
        429
      );
    }

    const subject =
      `A quick idea for ${businessName}`;

    const html = buildEmail({
      businessName,
      businessType,
      location
    });

    const response = await fetch(
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
          from: FROM_EMAIL,

          to: [email],

          subject,

          html,

          reply_to: REPLY_TO_EMAIL
        })
      }
    );

    const data =
      await response.json()
        .catch(() => ({}));

    if (!response.ok) {
      console.error(
        "Resend outreach error:",
        data
      );

      return json(
        {
          success: false,
          error:
            data?.message ||
            "The outreach email could not be sent."
        },
        502
      );
    }

    const result =
      await env.DB.prepare(`
        INSERT INTO prospects (
          business_name,
          business_type,
          location,
          contact_method,
          contact_details,
          status
        )
        VALUES (?, ?, ?, 'Email', ?, 'approached')
      `)
        .bind(
          businessName,
          businessType,
          location,
          email
        )
        .run();

    return json({
      success: true,

      message:
        "Outreach email sent and business recorded as approached.",

      emailId:
        data?.id || null,

      prospectId:
        result?.meta?.last_row_id || null,

      sentToday:
        sentToday + 1,

      dailyLimit:
        DAILY_LIMIT
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
          "Could not send outreach email."
      },
      500
    );
  }
}

function buildEmail({
  businessName,
  businessType,
  location
}) {
  const safeBusiness =
    escapeHtml(businessName);

  const safeType =
    escapeHtml(businessType);

  const safeLocation =
    escapeHtml(location);

  let intro =
    `I came across ${safeBusiness} and wanted to get in touch.`;

  if (safeType && safeLocation) {
    intro =
      `I came across ${safeBusiness}, a ${safeType} business in ${safeLocation}, and wanted to get in touch.`;
  }

  return `
    <div style="
      font-family:Arial,sans-serif;
      line-height:1.6;
      color:#222;
      max-width:600px;
      margin:auto;
    ">

      <p>Hi ${safeBusiness},</p>

      <p>${intro}</p>

      <p>
        I've built LocalBoost AI to help
        local businesses create professional
        social media posts and promotional
        content quickly.
      </p>

      <p>
        It can help create ideas, captions,
        promotions and social media content
        without spending hours putting
        everything together manually.
      </p>

      <p>
        You can take a look here:
        <a href="https://localboost4u.co.uk">
          localboost4u.co.uk
        </a>
      </p>

      <p>
        If it's not relevant for your business,
        just reply and I'll make sure you
        aren't contacted again.
      </p>

      <p>
        Kind regards,<br>
        Sam<br>
        LocalBoost AI
      </p>

    </div>
  `;
}

function clean(
  value,
  maxLength
) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(value);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCookie(
  header,
  name
) {
  const item = header
    .split(";")
    .map(value => value.trim())
    .find(
      value =>
        value.startsWith(name + "=")
    );

  return item
    ? item.slice(name.length + 1)
    : "";
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
