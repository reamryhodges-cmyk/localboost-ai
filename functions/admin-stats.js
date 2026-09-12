const ADMIN_EMAIL = "samtest1109@example.com";

export async function onRequestGet({ request, env }) {
  try {
    const token = getCookie(
      request.headers.get("Cookie") || "",
      "localboost_session"
    );

    if (!token) {
      return json(
        { success: false, error: "Please log in." },
        401
      );
    }

    const session = await env.DB.prepare(`
      SELECT s.expires_at, u.email
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `).bind(token).first();

    if (!session) {
      return json(
        { success: false, error: "Invalid session." },
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
      String(session.email || "").trim().toLowerCase() !==
      ADMIN_EMAIL
    ) {
      return json(
        { success: false, error: "Admin access only." },
        403
      );
    }

    const [a, s, st, b, p, recent] = await Promise.all([
      count(
        env,
        "SELECT COUNT(*) AS total FROM prospects"
      ),

      count(
        env,
        "SELECT COUNT(*) AS total FROM users"
      ),

      count(
        env,
        "SELECT COUNT(*) AS total FROM users WHERE LOWER(plan) = 'starter'"
      ),

      count(
        env,
        "SELECT COUNT(*) AS total FROM users WHERE LOWER(plan) IN ('business','growth')"
      ),

      count(
        env,
        "SELECT COUNT(*) AS total FROM users WHERE LOWER(plan) = 'pro'"
      ),

      env.DB.prepare(`
        SELECT
          id,
          business_name,
          business_type,
          location,
          contact_method,
          contact_details,
          status,
          approached_at
        FROM prospects
        ORDER BY id DESC
        LIMIT 50
      `).all()
    ]);

    const paid = st + b + p;

    const conversionRate = a
      ? Number(((paid / a) * 100).toFixed(1))
      : 0;

    const monthlyRevenue = Number(
      (
        st * 9.99 +
        b * 24.99 +
        p * 49.99
      ).toFixed(2)
    );

    return json({
      success: true,

      stats: {
        approached: a,
        signups: s,
        paid,
        starter: st,
        business: b,
        pro: p,
        conversionRate,
        monthlyRevenue
      },

      prospects: recent?.results || []
    });

  } catch (error) {
    console.error("Admin stats error:", error);

    return json(
      {
        success: false,
        error: "Could not load admin statistics."
      },
      500
    );
  }
}


async function count(env, sql) {
  const row =
    await env.DB.prepare(sql).first();

  return Number(row?.total || 0);
}


function getCookie(header, name) {
  const item = header
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith(name + "="));

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
