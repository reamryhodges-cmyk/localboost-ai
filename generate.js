export async function onRequestPost(context) {
  try {
    if (!context.env.DB) {
      return Response.json(
        {
          error: "Database is not connected."
        },
        {
          status: 500
        }
      );
    }

    if (!context.env.AI) {
      return Response.json(
        {
          error: "Workers AI binding is not configured."
        },
        {
          status: 500
        }
      );
    }


    // -------------------------
    // CHECK LOGIN SESSION
    // -------------------------

    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    let token = "";

    for (const part of cookieHeader.split(";")) {
      const cookie = part.trim();

      if (
        cookie.startsWith(
          "localboost_session="
        )
      ) {
        token =
          cookie.substring(
            "localboost_session=".length
          );

        break;
      }
    }


    if (!token) {
      return Response.json(
        {
          error: "Please log in to use the AI generator."
        },
        {
          status: 401
        }
      );
    }


    const session =
      await context.env.DB
        .prepare(`
          SELECT
            sessions.expires_at,
            users.id,
            users.email,
            users.business_name,
            users.plan,
            users.generations_used
          FROM sessions
          JOIN users
            ON users.id = sessions.user_id
          WHERE sessions.token = ?
        `)
        .bind(token)
        .first();


    if (!session) {
      return Response.json(
        {
          error: "Your login session is invalid. Please log in again."
        },
        {
          status: 401
        }
      );
    }


    const expiresAt =
      new Date(session.expires_at).getTime();


    if (
      Number.isNaN(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return Response.json(
        {
          error: "Your login session has expired. Please log in again."
        },
        {
          status: 401
        }
      );
    }


    // -------------------------
    // GET GENERATOR DETAILS
    // -------------------------

    const body =
      await context.request.json();

    const businessName =
      String(body.businessName || "").trim();

    const businessType =
      String(body.businessType || "").trim();

    const location =
      String(body.location || "").trim();

    const service =
      String(body.service || "").trim();

    const extraDetails =
      String(body.extraDetails || "").trim();


    if (!businessName || !businessType) {
      return Response.json(
        {
          error: "Business name and business type are required."
        },
        {
          status: 400
        }
      );
    }


    // -------------------------
    // CREATE SOCIAL POST
    // -------------------------

    const postPrompt = `
Write one short finished social media post for a UK local business.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Service: ${service}
Extra information: ${extraDetails}

Write approximately 60 to 100 words.

Requirements:
Use natural British English.
Start with a normal sentence, NOT hashtags.
Mention the business name.
Mention the service.
Include a clear call to action.
Finish with exactly 5 relevant hashtags.
Do not include explanations.
Do not include steps.
Do not include headings.
Do not include analysis.
Do not include notes.
Do not repeat the instructions.
Do not invent prices.
Do not invent phone numbers.
Do not invent awards or claims.

Return only the finished social media post.
`;


    const textResponse =
      await context.env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct-fast",
        {
          prompt: postPrompt,
          max_tokens: 180
        }
      );


    let post =
      textResponse.response ||
      textResponse.result ||
      "";


    post =
      String(post).trim();


    if (post.includes("---")) {
      post =
        post.split("---")[0];
    }


    if (post.includes("## Step")) {
      post =
        post.split("## Step")[0];
    }


    post =
      post.replace(
        /-1(?:-0){2,}.*$/s,
        ""
      );


    post =
      post.replace(
        /^#+\s*.*?\n+/g,
        ""
      );


    post =
      post.replace(
        /^(final answer|final post|social media post|finished post)\s*:?\s*/i,
        ""
      );


    // -------------------------
    // CLEAN HASHTAGS
    // -------------------------

    const hashtagMatches =
      post.match(
        /#[A-Za-z0-9_]+/g
      ) || [];


    const uniqueHashtags = [];


    for (const tag of hashtagMatches) {

      if (
        !uniqueHashtags.some(
          existing =>
            existing.toLowerCase() ===
            tag.toLowerCase()
        )
      ) {
        uniqueHashtags.push(tag);
      }


      if (
        uniqueHashtags.length === 5
      ) {
        break;
      }
    }


    post =
      post.replace(
        /#[A-Za-z0-9_]+/g,
        ""
      );


    post =
      post
        .replace(/[ \t]+/g, " ")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();


    const cleanBusinessName =
      businessName.replace(
        /[^A-Za-z0-9]/g,
        ""
      );


    const cleanBusinessType =
      businessType
        .replace(
          /[^A-Za-z0-9 ]/g,
          ""
        )
        .split(" ")
        .filter(Boolean)
        .join("");


    const cleanLocation =
      location.replace(
        /[^A-Za-z0-9]/g,
        ""
      );


    const backupHashtags = [
      cleanBusinessName
        ? `#${cleanBusinessName}`
        : "#LocalBusiness",

      cleanLocation
        ? `#${cleanLocation}`
        : "#UKBusiness",

      cleanBusinessType
        ? `#${cleanBusinessType}`
        : "#LocalServices",

      "#SupportLocal",

      "#LocalBusiness"
    ];


    for (const tag of backupHashtags) {

      if (
        uniqueHashtags.length < 5 &&
        !uniqueHashtags.some(
          existing =>
            existing.toLowerCase() ===
            tag.toLowerCase()
        )
      ) {
        uniqueHashtags.push(tag);
      }
    }


    uniqueHashtags.splice(5);


    post =
      post +
      "\n\n" +
      uniqueHashtags.join(" ");


    // -------------------------
    // CREATE AI PICTURE
    // -------------------------

    const safeBusinessType =
      businessType
        .replace(
          /[^\w\s-]/g,
          ""
        )
        .slice(0, 80);


    const safeService =
      service
        .replace(
          /[^\w\s-]/g,
          ""
        )
        .slice(0, 100);


    const safeLocation =
      location
        .replace(
          /[^\w\s-]/g,
          ""
        )
        .slice(0, 60);


    const imagePrompt = `
Professional commercial photograph for a ${safeBusinessType} business.

Show the service: ${safeService}.

Location style: ${safeLocation || "United Kingdom"}.

Clean realistic professional advertising photography.
Square composition suitable for social media.
No written text.
No logos.
No prices.
No phone numbers.
No watermarks.
`;


    let image = "";


    try {

      const imageResponse =
        await context.env.AI.run(
          "@cf/black-forest-labs/flux-1-schnell",
          {
            prompt: imagePrompt,
            steps: 4
          }
        );


      if (
        imageResponse &&
        imageResponse.image
      ) {
        image =
          `data:image/jpeg;charset=utf-8;base64,${imageResponse.image}`;
      }

    } catch (imageError) {

      console.log(
        "Image generation failed:",
        imageError.message
      );
    }


    // -------------------------
    // RETURN RESULT
    // -------------------------

    return Response.json({
      success: true,

      result: post,

      image: image,

      imageGenerated:
        image !== "",

      user: {
        id: session.id,
        email: session.email,
        plan: session.plan,
        generationsUsed:
          session.generations_used
      }
    });


  } catch (error) {

    console.log(
      "Generation error:",
      error.message
    );


    return Response.json(
      {
        error: "Something went wrong.",
        details: error.message
      },
      {
        status: 500
      }
    );
  }
}
