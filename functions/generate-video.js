const VIDEO_LIMITS = {
  starter: 2,
  business: 6,
  pro: 15
};

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

    const user = await env.DB.prepare(`
      SELECT
        u.id,
        u.email,
        u.business_name,
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
      return json(
        {
          success: false,
          error: "Invalid session."
        },
        401
      );
    }

    if (
      user.expires_at &&
      new Date(user.expires_at).getTime() <= Date.now()
    ) {
      return json(
        {
          success: false,
          error: "Session expired."
        },
        401
      );
    }

    const plan = String(user.plan || "free")
      .trim()
      .toLowerCase();

    if (!VIDEO_LIMITS[plan]) {
      return json(
        {
          success: false,
          error:
            "A paid LocalBoost plan is required for AI video advertising."
        },
        403
      );
    }

    if (!env.AI) {
      return json(
        {
          success: false,
          error:
            "AI video generation is not configured."
        },
        500
      );
    }

    let body = {};

    try {
      body = await request.json();
    } catch {
      return json(
        {
          success: false,
          error:
            "Invalid video generation request."
        },
        400
      );
    }

    const businessName = clean(
      body.businessName || user.business_name,
      150
    );

    const businessType = clean(
      body.businessType,
      150
    );

    const location = clean(
      body.location,
      150
    );

    const service = clean(
      body.service,
      250
    );

    const offer = clean(
      body.offer,
      250
    );

    const callToAction = clean(
      body.callToAction || "Contact us today",
      100
    );

    const format = [
      "9:16",
      "16:9",
      "1:1"
    ].includes(body.format)
      ? body.format
      : "9:16";

    if (
      !businessName ||
      !businessType ||
      !service
    ) {
      return json(
        {
          success: false,
          error:
            "Business name, business type and service are required."
        },
        400
      );
    }

    const prompt = [
      "Professional realistic advertising video for a real UK local business.",
      `Business: ${businessName}.`,
      `Business type: ${businessType}.`,
      location
        ? `Location: ${location}.`
        : "",
      `Service: ${service}.`,
      offer
        ? `Offer: ${offer}.`
        : "",
      `Call to action: ${callToAction}.`,
      "Show the service visually with realistic natural movement.",
      "Professional commercial cinematography.",
      "Clean, trustworthy local business advertising.",
      "No fake logos.",
      "Do not invent awards, reviews, guarantees or prices.",
      "Suitable for social media advertising."
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 2500);

    console.log(
      "Starting Wan 3.0 video generation",
      {
        userId: user.id,
        format,
        plan
      }
    );

    const response = await env.AI.run(
      "alibaba/wan-3.0",
      {
        prompt,
        resolution: "480P",
        ratio: format,
        duration: 5
      }
    );

    console.log(
      "Wan 3.0 response received",
      {
        state: response?.state || "",
        hasVideo:
          Boolean(response?.result?.video)
      }
    );

    const videoUrl =
      response?.result?.video ||
      response?.video ||
      "";

    if (!videoUrl) {
      console.error(
        "Wan 3.0 returned no video URL",
        response
      );

      return json(
        {
          success: false,
          error:
            "The AI video was not completed. Please try again."
        },
        502
      );
    }

    return json({
      success: true,
      video: videoUrl,
      format,
      duration: 5,
      plan,
      limit: VIDEO_LIMITS[plan],
      message:
        "Your LocalBoost AI video advert is ready."
    });

  } catch (error) {
    console.error(
      "Video generation error:",
      error?.message || error
    );

    return json(
      {
        success: false,
        error:
          "Could not create the video advert."
      },
      500
    );
  }
}

function clean(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function getCookie(header, name) {
  const item = String(header || "")
    .split(";")
    .map(value => value.trim())
    .find(value =>
      value.startsWith(name + "=")
    );

  return item
    ? decodeURIComponent(
        item.slice(name.length + 1)
      )
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
