const ADMIN_EMAIL = "samtest1109@example.com";

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
      return json({ success: false, error: "Please log in." }, 401);
    }

    const user = await env.DB.prepare(`
      SELECT
        u.id,
        u.email,
        u.business_name,
        u.plan,
        s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `).bind(token).first();

    if (!user) {
      return json({ success: false, error: "Invalid session." }, 401);
    }

    if (
      user.expires_at &&
      new Date(user.expires_at).getTime() <= Date.now()
    ) {
      return json({ success: false, error: "Session expired." }, 401);
    }

    const plan = String(user.plan || "free").toLowerCase();

    if (!VIDEO_LIMITS[plan]) {
      return json({
        success: false,
        error: "A paid LocalBoost plan is required for AI video advertising."
      }, 403);
    }

    if (!env.AI) {
      return json({
        success: false,
        error: "AI video generation is not configured."
      }, 500);
    }

    let body = {};

    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const businessName = clean(
      body.businessName || user.business_name,
      150
    );

    const businessType = clean(body.businessType, 150);
    const location = clean(body.location, 150);
    const service = clean(body.service, 250);
    const offer = clean(body.offer, 250);
    const callToAction = clean(
      body.callToAction || "Contact us today",
      100
    );

    const format = ["9:16", "16:9", "1:1"].includes(body.format)
      ? body.format
      : "9:16";

    if (!businessName || !businessType || !service) {
      return json({
        success: false,
        error: "Business name, business type and service are required."
      }, 400);
    }

    /*
      We will move this count into its own DB table before launch.
      For this build stage we deliberately keep generation controlled
      and avoid changing the database until the full system check.
    */

    const prompt = [
      "Create a professional short-form advertising video for a real UK local business.",
      `Business: ${businessName}.`,
      `Business type: ${businessType}.`,
      location ? `Location: ${location}.` : "",
      `Service being advertised: ${service}.`,
      offer ? `Offer: ${offer}.` : "",
      `Call to action: ${callToAction}.`,
      "Style: polished, realistic, trustworthy local-business advertising.",
      "Show the service visually with natural movement and professional commercial cinematography.",
      "Do not invent prices, awards, reviews, guarantees or factual claims.",
      "Do not generate fake logos.",
      "Suitable for social-media advertising.",
      format === "9:16"
        ? "Compose specifically for a vertical mobile advert."
        : "Compose specifically for the requested advertising format."
    ].filter(Boolean).join(" ");

    const response = await env.AI.run(
      "black-forest-labs/flux-3-video",
      {
        mode: "t2v",
        prompt: prompt,
        aspect_ratio: format,
        resolution: "hd",
        duration: 10,
        generate_audio: true,
        safety_tolerance: 2
      }
    );

    const videoUrl =
      response?.result?.video ||
      response?.video ||
      "";

    if (!videoUrl) {
      console.error("Video response:", response);

      return json({
        success: false,
        error: "The video could not be completed. Please try again."
      }, 502);
    }

    return json({
      success: true,
      video: videoUrl,
      format: format,
      duration: 10,
      plan: plan,
      message: "Your LocalBoost AI video advert is ready."
    });

  } catch (error) {
    console.error("Video generation error:", error);

    return json({
      success: false,
      error: "Could not create the video advert."
    }, 500);
  }
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function getCookie(header, name) {
  const item = header
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(name + "="));

  return item
    ? decodeURIComponent(item.slice(name.length + 1))
    : "";
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status: status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
