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

    if (!env.HUNTER_API_KEY) {
      return json(
        {
          success: false,
          error: "Hunter API is not configured."
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

    const query =
      String(
        body.query ||
        "Small and medium sized businesses based in the United Kingdom"
      )
        .trim()
        .slice(0, 500);

    const hunterUrl =
      `https://api.hunter.io/v2/discover?api_key=${
        encodeURIComponent(env.HUNTER_API_KEY)
      }`;

    const hunterResponse = await fetch(
      hunterUrl,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          query
        })
      }
    );

    const hunterData =
      await hunterResponse.json()
        .catch(() => ({}));

    if (!hunterResponse.ok) {
      console.error(
        "Hunter Discover error:",
        hunterData
      );

      return json(
        {
          success: false,
          error:
            hunterData?.errors?.[0]?.details ||
            hunterData?.errors?.[0]?.id ||
            hunterData?.message ||
            "Hunter could not find businesses."
        },
        hunterResponse.status
      );
    }

    const companies =
      Array.isArray(hunterData?.data)
        ? hunterData.data
        : [];

    const results = [];

    for (const company of companies) {
      const domain =
        String(company?.domain || "")
          .trim()
          .toLowerCase();

      const businessName =
        String(
          company?.organization ||
          company?.name ||
          domain
        ).trim();

      if (!domain || !businessName) {
        continue;
      }

      const existing =
        await env.DB.prepare(`
          SELECT id
          FROM prospects
          WHERE LOWER(business_name) = LOWER(?)
             OR LOWER(contact_details) LIKE LOWER(?)
          LIMIT 1
        `)
          .bind(
            businessName,
            `%${domain}%`
          )
          .first();

      if (existing) {
        continue;
      }

      const totalEmails =
        Number(
          company?.emails_count?.total || 0
        );

      if (totalEmails < 1) {
        continue;
      }

      results.push({
        businessName,
        domain,

        emailsAvailable:
          totalEmails,

        genericEmails:
          Number(
            company?.emails_count?.generic || 0
          ),

        personalEmails:
          Number(
            company?.emails_count?.personal || 0
          )
      });
    }

    return json({
      success: true,

      mode: "preview",

      country:
        "United Kingdom",

      query,

      found:
        companies.length,

      eligible:
        results.length,

      businesses:
        results,

      message:
        "UK business search complete. Preview only — no outreach emails have been sent."
    });

  } catch (error) {
    console.error(
      "UK business finder error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Could not search for UK businesses."
      },
      500
    );
  }
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
