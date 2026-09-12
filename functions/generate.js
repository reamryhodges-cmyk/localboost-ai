export async function onRequestPost(context) {
  try {
    // -----------------------------
    // CHECK REQUIRED BINDINGS
    // -----------------------------

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


    // -----------------------------
    // CHECK LOGIN SESSION
    // -----------------------------

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
          error:
            "Please log in to use the AI generator."
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
          error:
            "Your login session is invalid. Please log in again."
        },
        {
          status: 401
        }
      );
    }


    const expiry =
      new Date(
        session.expires_at
      ).getTime();


    if (
      Number.isNaN(expiry) ||
      expiry <= Date.now()
    ) {
      return Response.json(
        {
          error:
            "Your login session has expired. Please log in again."
        },
        {
          status: 401
        }
      );
    }


    // -----------------------------
    // GET FORM DETAILS
    // -----------------------------

    const body =
      await context.request.json();


    const businessName =
      String(
        body.businessName || ""
      ).trim();


    const businessType =
      String(
        body.businessType || ""
      ).trim();


    const location =
      String(
        body.location || ""
      ).trim();


    const service =
      String(
        body.service || ""
      ).trim();


    const extraDetails =
      String(
        body.extraDetails || ""
      ).trim();


    if (
      !businessName ||
      !businessType
    ) {
      return Response.json(
        {
          error:
            "Business name and business type are required."
        },
        {
          status: 400
        }
      );
    }


    // -----------------------------
    // CREATE SOCIAL MEDIA POST
    // -----------------------------

    const postPrompt = `
Create one finished social media post for a real UK local business.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Service or offer: ${service}
Extra information: ${extraDetails}

Rules:

Write between 60 and 100 words.

Use natural British English.

Write like an experienced social media manager.

Make the post sound friendly, professional and believable.

Use the exact business information supplied.

Do not invent people.

Do not invent an author's name.

Do not invent staff names.

Do not invent prices.

Do not invent discounts.

Do not invent phone numbers.

Do not invent awards.

Do not invent reviews or ratings.

Do not invent facts about the business.

Do not write:
"Here is the finished social media post"

Do not write:
"By..."

Do not write:
"Give your name as the author"

Do not provide explanations.

Do not provide instructions.

Do not provide analysis.

Do not use headings.

Do not use quotation marks around the whole post.

Include a clear and natural call to action.

Finish with exactly 5 relevant hashtags.

Return ONLY the finished social media post.
`;


    const textResponse =
      await context.env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct-fast",
        {
          prompt: postPrompt,
          max_tokens: 200
        }
      );


    let post =
      textResponse.response ||
      textResponse.result ||
      "";


    post =
      String(post).trim();


    // -----------------------------
    // CLEAN AI TEXT
    // -----------------------------

    post =
      post.replace(
        /^(here is|here's) the finished social media post\s*:?\s*/i,
        ""
      );


    post =
      post.replace(
        /^give your name as the author\.?\s*/i,
        ""
      );


    post =
      post.replace(
        /^by\s+[A-Za-z .'-]+\s*/i,
        ""
      );


    post =
      post.replace(
        /^(final answer|final post|social media post|finished post)\s*:?\s*/i,
        ""
      );


    if (post.includes("---")) {
      post =
        post.split("---")[0];
    }


    if (post.includes("## Step")) {
      post =
        post.split("## Step")[0];
    }


    // Remove strange repeated junk
    post =
      post.replace(
        /-1(?:-0){2,}.*$/s,
        ""
      );


    post =
      post.replace(
        /(?:£\s*){5,}/g,
        ""
      );


    // -----------------------------
    // HASHTAGS
    // -----------------------------

    const hashtagMatches =
      post.match(
        /#[A-Za-z0-9_]+/g
      ) || [];


    const uniqueHashtags = [];


    for (
      const tag of hashtagMatches
    ) {
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

      "#UKSmallBusiness"
    ];


    for (
      const tag of backupHashtags
    ) {
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


    // -----------------------------
    // CREATE AI PICTURE
    // -----------------------------

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
Create a realistic professional commercial photograph for a ${safeBusinessType} business.

Service being promoted:
${safeService}

Location style:
${safeLocation || "United Kingdom"}

Suitable for a professional social media advertisement.

Realistic photography.

Clean composition.

Square format.

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


    // -----------------------------
    // SEND RESULTS
    // -----------------------------

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
        error:
          "Something went wrong.",
        details:
          error.message
      },
      {
        status: 500
      }
    );
  }
}

