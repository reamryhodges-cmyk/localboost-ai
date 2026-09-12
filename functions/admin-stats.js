export async function onRequestGet(context) {
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
          error: "Session expired. Please log in again."
        },
        401
      );
    }

    const ADMIN_EMAIL = "samtest1109@example.com";

    if (
      String(session.email || "")
        .trim()
        .toLowerCase() !== ADMIN_EMAIL.toLowerCase()
    ) {
      return jsonResponse(
        {
          success: false,
          error: "Admin access only."
        },
        403
      );
    }

    const approachedRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM prospects
      `)
      .first();

    const approached =
      Number(approachedRow?.total || 0);

    const signupRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM users
      `)
      .first();

    const signups =
      Number(signupRow?.total || 0);

    const starterRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM users
        WHERE LOWER(plan) = 'starter'
      `)
      .first();

    const starter =
      Number(starterRow?.total || 0);

    const businessRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
       
