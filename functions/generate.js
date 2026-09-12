export async function onRequestPost(context) {
  const { request, env } = context;

  const PLAN_LIMITS = {
    starter: 30,
    business: 100,
    pro: 300
  };

  try {
    // -----------------------------
    // 1. GET SESSION COOKIE
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
          error: "Please log in to use the AI generator."
        },
        401
      );
    }

    // -----------------------------
    // 2. FIND LOGGED-IN USER
    // -----------------------------
    const session = await env.DB
      .prepare(`
        SELECT
          s.user_id,
          s.expires_at,
          u.email,
          u.business_name,
          u.plan,
          u.generations_used,
          u.generation_period_start
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
          error: "Your login session has expired. Please log in again."
        },
        401
      );
    }

    if (
      session.expires_at &&
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      await env.DB
        .prepare(`
          DELETE FROM sessions
          WHERE token = ?
        `)
        .bind(sessionToken)
        .run();

      return jsonResponse(
        {
          success: false,
          error: "Your login session has expired. Please log in again."
        },
        401
      );
    }

    // -----------------------------
    // 3. NORMALISE PLAN
    // -----------------------------
    let plan = String(session.plan || "free").toLowerCase();

    // Compatibility with old Growth name.
    if (plan === "growth") {
      plan = "business";
    }

    if (!PLAN_LIMITS[plan]) {
      return jsonResponse(
        {
          success: false,
          error: "You need an active paid plan to use the AI generator."
        },
        403
      );
    }

    const limit = PLAN_LIMITS[plan];

    // -----------------------------
    // 4. MONTHLY USAGE PERIOD
    // -----------------------------
    const now = new Date();

    let periodStart = session.generation_period_start
      ? new Date(session.generation_period_start)
      : null;

    let generationsUsed = Number(session.generations_used || 0);

    let resetRequired = false;

    if (
      !periodStart ||
      Number.isNaN(periodStart.getTime())
    ) {
      resetRequired = true;
    } else {
      const nextReset = new Date(periodStart);

      nextReset.setUTCMonth(
        nextReset.getUTCMonth() + 1
      );

      if (now >= nextReset) {
        resetRequired = true;
      }
    }

    if (resetRequired) {
      periodStart = now;
      generationsUsed = 0;

      await env.DB
        .prepare(`
          UPDATE users
          SET
            generations_used = 0,
            generation_period_start = ?
          WHERE id = ?
        `)
        .bind(
          now.toISOString(),
          session.user_id
        )
        .run();
    }

    // -----------------------------
    // 5. CHECK PLAN LIMIT
    // -----------------------------
    if (generationsUsed >= limit) {
      return jsonResponse(
        {
          success: false,
          error:
            `You have used all ${limit} generations included in your ${capitalise(plan)} plan this month.`,
          plan,
          generationsUsed,
          limit,
          remaining: 0
        },
        403
      );
    }

    // -----------------------------
    // 6. READ GENERATOR FORM
    // -----------------------------
    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "Invalid generator request."
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

    const service =
      clean(body.service);

    const extraDetails =
      clean(body.extraDetails);

    if (
      !businessName ||
      !businessType ||
      !location ||
      !service
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "Please complete the business name, business type, location and service."
        },
        400
      );
    }

    // -----------------------------
    // 7. CREATE SOCIAL MEDIA POST
    // -----------------------------
    const textPrompt = `
You are LocalBoost AI, a professional UK social media marketing assistant.

Create one high-quality social media post for this local business.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Service or offer: ${service}
Extra details: ${extraDetails || "None provided"}

Requirements:
- Write naturally in British English.
- Make it sound like a genuine local business.
- Do not make up prices, discounts, awards or guarantees.
- Keep it concise and engaging.
- Start with a strong opening line.
- Clearly explain the service.
- Mention the location naturally.
- Include a clear call to action.
- Finish with 4 to 7 relevant hashtags.
- Do not include headings such as "Caption" or "Social Media Post".
`;

    const textResult = await env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct-fast",
      {
        messages: [
          {
            role: "system",
            content:
              "You create professional social media content for UK local businesses."
          },
          {
            role: "user",
            content: textPrompt
          }
        ],
        max_tokens: 500
      }
    );

    const postText =
      textResult?.response ||
      textResult?.result?.response ||
      textResult?.text ||
      "";

    if (!postText) {
      throw new Error(
        "The AI did not return a social media post."
      );
    }

    // -----------------------------
    // 8. CREATE IMAGE
    // -----------------------------
    const imagePrompt = `
Create a realistic professional advertising photograph for a UK local business.

Business: ${businessName}
Business type: ${businessType}
Location: ${location}
Service: ${service}

The image should look suitable for Facebook or Instagram.

Requirements:
- realistic commercial photography
- professional and trustworthy
- clean composition
- relevant to the service
- no logos
- no watermarks
- no written text
- no fake prices
- no promotional banners
`;

    const imageResult = await env.AI.run(
      "@cf/black-forest-labs/flux-1-schnell",
      {
        prompt: imagePrompt,
        steps: 4
      }
    );

    let imageData = null;

    if (imageResult) {
      if (typeof imageResult === "string") {
        imageData = imageResult;
      } else if (imageResult.image) {
        imageData = imageResult.image;
      } else if (imageResult.result?.image) {
        imageData = imageResult.result.image;
      }
    }

    if (imageData && !imageData.startsWith("data:")) {
      imageData =
        "data:image/jpeg;base64," +
        imageData;
    }

    // -----------------------------
    // 9. INCREASE USAGE ONLY AFTER
    // SUCCESSFUL GENERATION
    // -----------------------------
    const newUsage =
      generationsUsed + 1;

    await env.DB
      .prepare(`
        UPDATE users
        SET generations_used = ?
        WHERE id = ?
      `)
      .bind(
        newUsage,
        session.user_id
      )
      .run();

    // -----------------------------
    // 10. RETURN RESULT
    // -----------------------------
    return jsonResponse(
      {
        success: true,

        result: postText,

        post: postText,

        image: imageData,

        plan,

        generationsUsed: newUsage,

        limit,

        remaining:
          Math.max(
            0,
            limit - newUsage
          )
      },
      200
    );

  } catch (error) {
    console.error(
      "LocalBoost generate error:",
      error
    );

    return jsonResponse(
      {
        success: false,
        error:
          "Something went wrong while creating your post. Please try again."
      },
      500
    );
  }
}


function clean(value) {
  return String(value || "")
    .trim()
    .slice(0, 1000);
}


function capitalise(value) {
  if (!value) {
    return "";
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
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
