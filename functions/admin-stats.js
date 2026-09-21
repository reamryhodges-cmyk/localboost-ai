const ADMIN_EMAIL =
  "reamryhodges@gmail.com";

const DAILY_OUTREACH_LIMIT = 50;

export async function onRequestGet({
  request,
  env
}) {
  try {
    const token =
      getCookie(
        request.headers.get(
          "Cookie"
        ) || "",
        "localboost_session"
      );

    if (!token) {
      return json(
        {
          success: false,
          error:
            "Please log in."
        },
        401
      );
    }

    const session =
      await env.DB.prepare(`
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
          error:
            "Invalid session."
        },
        401
      );
    }

    if (
      session.expires_at &&
      new Date(
        session.expires_at
      ).getTime() <=
      Date.now()
    ) {
      return json(
        {
          success: false,

          error:
            "Session expired. Please log in again."
        },
        401
      );
    }

    if (
      String(
        session.email || ""
      )
        .trim()
        .toLowerCase() !==
      ADMIN_EMAIL
    ) {
      return json(
        {
          success: false,
          error:
            "Admin access only."
        },
        403
      );
    }

    const [
      totalApproached,
      totalSignups,
      starter,
      business,
      pro,
      sentToday,
      recent
    ] =
      await Promise.all([
        count(
          env,
          `
          SELECT COUNT(*) AS total
          FROM prospects
          `
        ),

        count(
          env,
          `
          SELECT COUNT(*) AS total
          FROM users
          `
        ),

        count(
          env,
          `
          SELECT COUNT(*) AS total
          FROM users
          WHERE LOWER(plan) = 'starter'
          `
        ),

        count(
          env,
          `
          SELECT COUNT(*) AS total
          FROM users
          WHERE LOWER(plan)
          IN (
            'business',
            'growth'
          )
          `
        ),

        count(
          env,
          `
          SELECT COUNT(*) AS total
          FROM users
          WHERE LOWER(plan) = 'pro'
          `
        ),

        count(
          env,
          `
          SELECT COUNT(*) AS total
          FROM prospects
          WHERE
            LOWER(contact_method) =
              'email'
          AND
            DATE(approached_at) =
              DATE('now')
          `
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
        `)
          .all()
      ]);

    const paidCustomers =
      starter +
      business +
      pro;

    const conversionRate =
      totalApproached > 0
        ? Number(
            (
              (
                paidCustomers /
                totalApproached
              ) *
              100
            ).toFixed(1)
          )
        : 0;

    const estimatedMRR =
      Number(
        (
          starter * 9.99 +
          business * 24.99 +
          pro * 49.99
        ).toFixed(2)
      );

    const remainingToday =
      Math.max(
        0,
        DAILY_OUTREACH_LIMIT -
        sentToday
      );

    const recentProspects =
      Array.isArray(
        recent?.results
      )
        ? recent.results
        : [];

    /*
      Return both top-level values and
      grouped objects.

      This keeps the current admin page
      working while also keeping the API
      useful for future dashboard updates.
    */

    return json({
      success: true,

      totalApproached,
      totalSignups,
      paidCustomers,

      starter,
      business,
      pro,

      conversionRate,
      estimatedMRR,

      sentToday,

      dailyLimit:
        DAILY_OUTREACH_LIMIT,

      remainingToday,

      recent:
        recentProspects,

      recentProspects,

      stats: {
        approached:
          totalApproached,

        signups:
          totalSignups,

        paid:
          paidCustomers,

        starter,
        business,
        pro,

        conversionRate,

        monthlyRevenue:
          estimatedMRR,

        sentToday,

        dailyLimit:
          DAILY_OUTREACH_LIMIT,

        remainingToday
      },

      prospects:
        recentProspects
    });

  } catch (error) {
    console.error(
      "Admin stats error:",
      error
    );

    return json(
      {
        success: false,

        error:
          "Could not load admin statistics."
      },
      500
    );
  }
}


async function count(
  env,
  sql
) {
  const row =
    await env.DB
      .prepare(sql)
      .first();

  return Number(
    row?.total || 0
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
    ? item.slice(
        name.length + 1
      )
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
