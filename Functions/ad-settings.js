const PAID_PLANS = [
  "starter",
  "business",
  "pro"
];

export async function onRequestGet({
  request,
  env
}) {
  try {
    const user =
      await auth(
        request,
        env
      );

    if (!user) {
      return json(
        {
          success: false,
          error:
            "Please log in."
        },
        401
      );
    }

    const settings =
      await env.DB.prepare(`
        SELECT
          facebook_instagram,
          google_ads,
          youtube_ads,
          objective,
          service,
          target_location,
          radius_miles,
          daily_budget,
          call_to_action,
          approval_required,
          status
        FROM ad_settings
        WHERE user_id = ?
        LIMIT 1
      `)
        .bind(user.id)
        .first();

    return json({
      success: true,

      settings:
        settings || {
          facebook_instagram: 0,
          google_ads: 0,
          youtube_ads: 0,
          objective: "",
          service: "",
          target_location: "",
          radius_miles: 15,
          daily_budget: null,
          call_to_action:
            "Contact us today",
          approval_required: 1,
          status: "setup"
        }
    });

  } catch (error) {
    console.error(
      "Ad settings load error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Could not load advertising settings."
      },
      500
    );
  }
}


export async function onRequestPost({
  request,
  env
}) {
  try {
    const user =
      await auth(
        request,
        env
      );

    if (!user) {
      return json(
        {
          success: false,
          error:
            "Please log in."
        },
        401
      );
    }

    const plan =
      String(
        user.plan || ""
      )
        .trim()
        .toLowerCase();

    if (
      !PAID_PLANS.includes(
        plan
      )
    ) {
      return json(
        {
          success: false,
          error:
            "A paid LocalBoost plan is required for advertising."
        },
        403
      );
    }

    let body = {};

    try {
      body =
        await request.json();
    } catch {
      return json(
        {
          success: false,
          error:
            "Invalid advertising setup."
        },
        400
      );
    }

    const facebook =
      body.facebookInstagram
        ? 1
        : 0;

    const google =
      body.googleAds
        ? 1
        : 0;

    const youtube =
      body.youtubeAds
        ? 1
        : 0;

    if (
      !facebook &&
      !google &&
      !youtube
    ) {
      return json(
        {
          success: false,
          error:
            "Choose at least one advertising platform."
        },
        400
      );
    }

    const objective =
      clean(
        body.objective,
        80
      );

    const service =
      clean(
        body.service,
        250
      );

    const location =
      clean(
        body.targetLocation,
        150
      );

    const callToAction =
      clean(
        body.callToAction ||
          "Contact us today",
        100
      );

    const radius =
      Math.max(
        1,
        Math.min(
          100,
          Number(
            body.radiusMiles
          ) || 15
        )
      );

    const budget =
      Number(
        body.dailyBudget
      );

    if (
      !service ||
      !location
    ) {
      return json(
        {
          success: false,
          error:
            "Service and target location are required."
        },
        400
      );
    }

    if (
      !Number.isFinite(
        budget
      ) ||
      budget < 1 ||
      budget > 10000
    ) {
      return json(
        {
          success: false,
          error:
            "Enter a valid daily advertising budget."
        },
        400
      );
    }

    await env.DB.prepare(`
      INSERT INTO ad_settings (
        user_id,
        facebook_instagram,
        google_ads,
        youtube_ads,
        objective,
        service,
        target_location,
        radius_miles,
        daily_budget,
        call_to_action,
        approval_required,
        status,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        1,
        'ready_for_connection',
        CURRENT_TIMESTAMP
      )

      ON CONFLICT(user_id)
      DO UPDATE SET
        facebook_instagram =
          excluded.facebook_instagram,

        google_ads =
          excluded.google_ads,

        youtube_ads =
          excluded.youtube_ads,

        objective =
          excluded.objective,

        service =
          excluded.service,

        target_location =
          excluded.target_location,

        radius_miles =
          excluded.radius_miles,

        daily_budget =
          excluded.daily_budget,

        call_to_action =
          excluded.call_to_action,

        approval_required = 1,

        status =
          'ready_for_connection',

        updated_at =
          CURRENT_TIMESTAMP
    `)
      .bind(
        user.id,
        facebook,
        google,
        youtube,
        objective,
        service,
        location,
        radius,
        budget,
        callToAction
      )
      .run();

    return json({
      success: true,

      message:
        "Advertising setup saved. No adverts were launched and no money was spent."
    });

  } catch (error) {
    console.error(
      "Ad settings save error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Could not save advertising settings."
      },
      500
    );
  }
}


async function auth(
  request,
  env
) {
  const token =
    getCookie(
      request.headers.get(
        "Cookie"
      ) || "",
      "localboost_session"
    );

  if (!token) {
    return null;
  }

  const user =
    await env.DB.prepare(`
      SELECT
        u.id,
        u.email,
        u.plan,
        s.expires_at
      FROM sessions s
      JOIN users u
        ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `)
      .bind(token)
      .first();

  if (!user) {
    return null;
  }

  if (
    user.expires_at &&
    new Date(
      user.expires_at
    ).getTime() <=
      Date.now()
  ) {
    return null;
  }

  return user;
}


function clean(
  value,
  maxLength
) {
  return String(
    value || ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );
}


function getCookie(
  header,
  name
) {
  const item =
    String(
      header || ""
    )
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
    ? decodeURIComponent(
        item.slice(
          name.length + 1
        )
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
