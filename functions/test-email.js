const ADMIN_EMAIL = "samtest1109@example.com";

export async function onRequestPost({ request, env }) {
  try {
    // Check login cookie
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

    // Check logged-in user
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

    // Check session expiry
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

    // Only allow admin test account
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

    // Make sure Resend API key exists
    if (!env.RESEND_API_KEY) {
      return json(
        {
          success: false,
          error: "RESEND_API_KEY is not configured."
        },
        500
      );
    }

    let body = {};

    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const to =
      String(body.to || ADMIN_EMAIL)
        .trim()
        .toLowerCase();

    // Send test email through Resend
    const response = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${env.RESEND_API_KEY}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          from:
            "LocalBoost AI <hello@localboost4u.co.uk>",

          to: [to],

          subject:
            "LocalBoost AI email test",

          html: `
            <div style="
              font-family:Arial,sans-serif;
              max-width:600px;
              margin:auto;
              padding:30px;
            ">

              <h1>LocalBoost AI</h1>

              <h2>✅ Email system working</h2>

              <p>
                This is a test email from
                LocalBoost AI.
              </p>

              <p>
                Your website can now communicate
                with customers by email.
              </p>

              <hr>

              <p style="
                color:#666;
                font-size:13px;
              ">
                Sent from localboost4u.co.uk
              </p>

            </div>
          `
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Resend error:",
        data
      );

      return json(
        {
          success: false,
          error:
            data?.message ||
            "Resend could not send the email."
        },
        response.status
      );
    }

    return json({
      success: true,
      message: "Test email sent successfully.",
      emailId: data.id || null
    });

  } catch (error) {
    console.error(
      "Test email error:",
      error
    );

    return json(
      {
        success: false,
        error: "Could not send test email."
      },
      500
    );
  }
}

function getCookie(header, name) {
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

function json(data, status = 200) {
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
