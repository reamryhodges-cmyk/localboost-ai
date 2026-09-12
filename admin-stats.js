export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    // -----------------------------
    // 1. CHECK LOGIN SESSION
    // -----------------------------
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

    // -----------------------------
    // 2. ADMIN-ONLY ACCESS
    // -----------------------------
    const ADMIN_EMAIL =
      "samtest1109@example.com";

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

    // -----------------------------
    // 3. COUNT APPROACHED LEADS
    // -----------------------------
    const approachedRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM leads
      `)
      .first();

    const approached =
      Number(approachedRow?.total || 0);

    // -----------------------------
    // 4. COUNT SIGNUPS
    // -----------------------------
    const signupRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM users
      `)
      .first();

    const signups =
      Number(signupRow?.total || 0);

    // -----------------------------
    // 5. COUNT PAID CUSTOMERS
    // -----------------------------
    const paidRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM users
        WHERE LOWER(plan) IN (
          'starter',
          'business',
          'growth',
          'pro'
        )
      `)
      .first();

    const paid =
      Number(paidRow?.total || 0);

    // -----------------------------
    // 6. PLAN COUNTS
    // -----------------------------
    const starterRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM users
        WHERE LOWER(plan) = 'starter'
      `)
      .first();

    const businessRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM users
        WHERE LOWER(plan) IN (
          'business',
          'growth'
        )
      `)
      .first();

    const proRow = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM users
        WHERE LOWER(plan) = 'pro'
      `)
      .first();

    const starter =
      Number(starterRow?.total || 0);

    const business =
      Number(businessRow?.total || 0);

    const pro =
      Number(proRow?.total || 0);

    // -----------------------------
    // 7. CONVERSION RATE
    // -----------------------------
    const conversionRate =
      approached > 0
        ? Number(
            (
              (paid / approached) *
              100
            ).toFixed(1)
          )
        : 0;

    // -----------------------------
    // 8. MONTHLY RECURRING REVENUE
    // -----------------------------
    const monthlyRevenue =
      Number(
        (
          starter * 9.99 +
          business * 24.99 +
          pro * 49.99
        ).toFixed(2)
      );

    // -----------------------------
    // 9. RECENT LEADS
    // -----------------------------
    const recentLeadsResult =
      await env.DB
        .prepare(`
          SELECT
            id,
            business_name,
            contact_name,
            email,
            phone,
            status,
            plan,
            approached_at,
            signed_up_at,
            paid_at
          FROM leads
          ORDER BY id DESC
          LIMIT 50
        `)
        .all();

    const recentLeads =
      recentLeadsResult?.results || [];

    // -----------------------------
    // 10. RETURN ADMIN STATS
    // -----------------------------
    return jsonResponse(
      {
        success: true,

        stats: {
          approached,
          signups,
          paid,

          starter,
          business,
          pro,

          conversionRate,
          monthlyRevenue
        },

        leads: recentLeads
      },
      200
    );

  } catch (error) {
    console.error(
      "Admin stats error:",
      error
    );

    return jsonResponse(
      {
        success: false,
        error:
          "Could not load admin statistics."
      },
      500
    );
  }
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
