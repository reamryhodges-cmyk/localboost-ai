export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const cookieHeader = request.headers.get("Cookie") || "";

    const cookies = Object.fromEntries(
      cookieHeader
        .split(";")
        .map(cookie => cookie.trim())
        .filter(Boolean)
        .map(cookie => {
          const separator = cookie.indexOf("=");

          if (separator === -1) {
            return [cookie, ""];
          }

          return [
            cookie.slice(0, separator),
            cookie.slice(separator + 1)
          ];
        })
    );

    const sessionToken = cookies.localboost_session;

    if (!sessionToken) {
      return jsonResponse(
        {
          success: false,
          error: "Please log in."
        },
        401
      );
    }

    const session = await env.DB
      .prepare(`
        SELECT
          s.user_id,
          s.expires_at,
          u.email
        FROM sessions s
        JOIN users u
          ON u.id = s.user_id
        WHERE s.token = ?
        LIMIT 1
      `)
      .bind(sessionToken)
      .first();

    if (!session) {
      return jsonResponse(
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
      return jsonResponse(
        {
          success: false,
          error: "Session expired."
        },
        401
      );
    }

    const ADMIN_EMAIL = "samtest1109@example.com";

    if (
      String(session.email || "")
        .trim()
        .toLowerCase() !==
      ADMIN_EMAIL.toLowerCase()
    ) {
      return jsonResponse(
        {
          success: false,
          error: "Admin access only."
        },
        403
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "Invalid request."
        },
        400
      );
    }

    const businessName =
      clean(body.businessName);

    const businessType =
      clean(body.businessType);

    const location =
      clean(body.location);

    const contactMethod =
      clean(body.contactMethod);

    const contactDetails =
      clean(body.contactDetails);

    if (!businessName) {
      return jsonResponse(
        {
          success: false,
          error: "Business name is required."
        },
        400
      );
    }

    await env.DB
      .prepare(`
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
        contactMethod,
        contactDetails
      )
      .run();

    return jsonResponse(
      {
        success: true,
        message: "Business recorded as approached."
      },
      200
    );

  } catch (error) {
    console.error(
      "Add prospect error:",
      error
    );

    return jsonResponse(
      {
        success: false,
        error: "Could not record business."
      },
      500
    );
  }
}


function clean(value) {
  return String(value || "")
    .trim()
    .slice(0, 500);
}


function jsonResponse(data, status = 200) {
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
