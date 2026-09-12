const ADMIN_EMAIL = "samtest1109@example.com";

export async function onRequestPost({ request, env }) {
  try {
    // Check admin login
    const token = getCookie(
      request.headers.get("Cookie") || "",
      "localboost_session"
    );

    if (!token) {
      return json({
        success: false,
        error: "Please log in."
      }, 401);
    }

    const session = await env.DB.prepare(`
      SELECT
        s.expires_at,
        u.email
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `)
      .bind(token)
      .first();

    if (!session) {
      return json({
        success: false,
        error: "Invalid session."
      }, 401);
    }

    if (
      session.expires_at &&
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      return json({
        success: false,
        error: "Session expired. Please log in again."
      }, 401);
    }

    if (
      String(session.email || "")
        .trim()
        .toLowerCase() !== ADMIN_EMAIL
    ) {
      return json({
        success: false,
        error: "Admin access only."
      }, 403);
    }

    // Check Resend API key
    if (!env.RESEND_API_KEY) {
      return json({
        success: false,
        error: "RESEND_API_KEY is not configured."
      }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({
        success: false,
        error: "Invalid request."
      }, 400);
    }

    const businessName = clean(body.businessName);
    const businessType = clean(body.businessType);
    const location = clean(body.location);
    const email = clean(body.email).toLowerCase();

    if (!businessName) {
      return json({
        success: false,
        error: "Business name is required."
      }, 400);
    }

    if (!email || !isValidEmail(email)) {
      return json({
        success: false,
        error: "A valid business email is required."
      }, 400);
    }

    // Send outreach email through Resend
    const emailResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "LocalBoost AI <hello@localboost4u.co.uk>",
          to: [email],
          subject: `A quick idea for ${businessName}`,
          html: buildEmail({
            businessName,
            businessType,
            location
          })
        })
      }
    );

    const emailData = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error("Resend error:", emailData);

      return json({
        success: false,
        error:
          emailData?.message ||
          "The outreach email could not be sent."
      }, 502);
    }

    // Only record as approached AFTER Resend accepts the email
    const result = await env.DB.prepare(`
      INSERT INTO prospects (
        business_name,
        business_type,
        location,
        contact_method,
        contact_details,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'approached')
    `)
      .bind(
        businessName,
        businessType,
        location,
        "Email",
        email
      )
      .run();

    return json({
      success: true,
      message: `Outreach email sent to ${businessName}.`,
      emailId: emailData?.id || null,
      prospectId: result?.meta?.last_row_id || null
    });

  } catch (error) {
    console.error("Send outreach error:", error);

    return json({
      success: false,
      error: "Could not send outreach email."
    }, 500);
  }
}

function buildEmail({
  businessName,
  businessType,
  location
}) {
  const safeBusiness = escapeHtml(businessName);
  const safeType = escapeHtml(businessType);
  const safeLocation = escapeHtml(location);

  const businessLine =
    safeType && safeLocation
      ? `I came across ${safeBusiness}, a ${safeType} business in ${safeLocation}.`
      : `I came across ${safeBusiness} and wanted to get in touch.`;

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:600px;">
      <p>Hi ${safeBusiness},</p>

      <p>${businessLine}</p>

      <p>
        I've built LocalBoost AI to help local businesses create
        professional social media posts and images quickly,
        without needing to spend hours creating content.
      </p>

      <p>
        LocalBoost AI can help you create promotional posts,
        service adverts and social media content for your business.
      </p>

      <p>
        You can take a look here:
        <a href="https://localboost4u.co.uk">
          localboost4u.co.uk
        </a>
      </p>

      <p>
        Kind regards,<br>
        Sam<br>
        LocalBoost AI
      </p>
    </div>
  `;
}

function clean(value) {
  return String(value || "")
    .trim()
    .slice(0, 500);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCookie(header, name) {
  const item = header
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(name + "="));

  return item
    ? item.slice(name.length + 1)
    : "";
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
