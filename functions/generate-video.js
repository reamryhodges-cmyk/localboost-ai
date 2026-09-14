const VIDEO_LIMITS = {
  starter: 2,
  business: 6,
  pro: 15
};

const ADMIN_TEST_EMAIL = "samtest1109@example.com";

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

    if (!env.DB) {
      return json(
        {
          success: false,
          error: "Database is not configured."
        },
        500
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

    const email = String(user.email || "")
      .trim()
      .toLowerCase();

    const isAdminTest =
      email === ADMIN_TEST_EMAIL.toLowerCase();

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
            isAdminTest
              ? "AI diagnostic: Workers AI binding 'AI' is not available."
              : "AI video generation is not configured."
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
          error: "Invalid video generation request."
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
      "Create a professional realistic advertising video for a real UK local business.",
      `Business: ${businessName}.`,
      `Business type: ${businessType}.`,
      location
        ? `Location: ${location}.`
        : "",
      `Service being advertised: ${service}.`,
      offer
        ? `Special offer: ${offer}.`
        : "",
      `Call to action: ${callToAction}.`,
      "Show the service being performed visually.",
      "Use realistic natural movement.",
      "Use polished professional commercial cinematography.",
      "Make the business look trustworthy and professional.",
      "Do not generate fake logos.",
      "Do not invent awards, reviews, guarantees or factual claims.",
      "Do not add unreadable or distorted text into the video.",
      "Suitable for social media advertising.",
      format === "9:16"
        ? "The intended final use is a vertical mobile social media advert."
        : format === "16:9"
        ? "The intended final use is a landscape advertising video."
        : "The intended final use is a square social media advert."
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 2500);

    console.log(
      "Starting Wan 3.0 Prime video generation",
      {
        userId: user.id,
        plan,
        requestedFormat: format
      }
    );

    let response;

    try {
      response = await env.AI.run(
        "alibaba/wan-3.0-prime",
        {
          prompt,
          resolution: "480P",
          ratio: "adaptive",
          duration: 5
        }
      );
    } catch (aiError) {
      console.error(
        "Workers AI video call failed:",
        aiError
      );

      const diagnostic =
        extractError(aiError);

      return json(
        {
          success: false,
          error:
            isAdminTest
              ? `AI diagnostic: ${diagnostic}`
              : "Could not create the video advert."
        },
        502
      );
    }

    console.log(
      "Wan 3.0 Prime raw response",
      safeLog(response)
    );

    const videoUrl =
      findVideoUrl(response);

    if (!videoUrl) {
      const summary =
        describeResponse(response);

      console.error(
        "Wan 3.0 Prime returned no usable video URL:",
        summary
      );

      return json(
        {
          success: false,
          error:
            isAdminTest
              ? `AI diagnostic: model responded but no video URL was found. Response: ${summary}`
              : "The AI video was not completed. Please try again."
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
      error
    );

    const diagnostic =
      extractError(error);

    let admin = false;

    try {
      const token = getCookie(
        request.headers.get("Cookie") || "",
        "localboost_session"
      );

      if (token && env.DB) {
        const session = await env.DB.prepare(`
          SELECT u.email
          FROM sessions s
          JOIN users u
            ON u.id = s.user_id
          WHERE s.token = ?
          LIMIT 1
        `)
          .bind(token)
          .first();

        admin =
          String(session?.email || "")
            .trim()
            .toLowerCase() ===
          ADMIN_TEST_EMAIL.toLowerCase();
      }
    } catch (_) {}

    return json(
      {
        success: false,
        error:
          admin
            ? `AI diagnostic: ${diagnostic}`
            : "Could not create the video advert."
      },
      500
    );
  }
}

function findVideoUrl(response) {
  const candidates = [
    response?.result?.video,
    response?.video,
    response?.result?.url,
    response?.url,
    response?.result?.output,
    response?.output
  ];

  for (const value of candidates) {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  if (
    response?.result?.video?.url &&
    typeof response.result.video.url === "string"
  ) {
    return response.result.video.url.trim();
  }

  if (
    response?.video?.url &&
    typeof response.video.url === "string"
  ) {
    return response.video.url.trim();
  }

  return "";
}

function describeResponse(response) {
  try {
    if (response === null) {
      return "null";
    }

    if (response === undefined) {
      return "undefined";
    }

    if (typeof response === "string") {
      return response.slice(0, 500);
    }

    if (response instanceof ArrayBuffer) {
      return `ArrayBuffer(${response.byteLength} bytes)`;
    }

    if (ArrayBuffer.isView(response)) {
      return `${response.constructor?.name || "TypedArray"}(${response.byteLength} bytes)`;
    }

    const text =
      JSON.stringify(response);

    if (!text) {
      return Object.prototype.toString.call(response);
    }

    return text.slice(0, 800);

  } catch (error) {
    return `Unserializable response: ${extractError(error)}`;
  }
}

function safeLog(response) {
  return {
    type:
      response === null
        ? "null"
        : typeof response,

    constructor:
      response?.constructor?.name ||
      "",

    summary:
      describeResponse(response)
  };
}

function extractError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (
    typeof error === "string"
  ) {
    return error.slice(0, 1000);
  }

  const parts = [];

  if (error.name) {
    parts.push(
      String(error.name)
    );
  }

  if (error.message) {
    parts.push(
      String(error.message)
    );
  }

  if (error.cause) {
    try {
      parts.push(
        `cause=${JSON.stringify(error.cause)}`
      );
    } catch {
      parts.push(
        `cause=${String(error.cause)}`
      );
    }
  }

  if (error.status) {
    parts.push(
      `status=${error.status}`
    );
  }

  if (error.code) {
    parts.push(
      `code=${error.code}`
    );
  }

  return (
    parts.join(" | ") ||
    String(error)
  ).slice(0, 1200);
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
