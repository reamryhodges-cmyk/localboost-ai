const ADMIN_EMAIL = "samtest1109@example.com";

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

    const businessName = clean(body.businessName);
    const businessType = clean(body.businessType);
    const location = clean(body.location);
    const contactMethod = clean(body.contactMethod);
    const contactDetails = clean(body.contactDetails);

    if (!businessName) {
      return json(
        {
          success: false,
          error: "Business name is required."
        },
        400
      );
    }

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
        contactMethod,
        contactDetails
      )
      .run();

    return json({
      success: true,
      message: "Business recorded as approached.",
      id: result?.meta?.last_row_id || null
    });

  } catch (error) {
    console.error("Add prospect error:", error);

    return json(
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
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
