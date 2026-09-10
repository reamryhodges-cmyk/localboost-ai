export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const businessName = body.businessName || "";
    const businessType = body.businessType || "";
    const location = body.location || "";
    const service = body.service || "";
    const extraDetails = body.extraDetails || "";

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

    // CREATE SOCIAL MEDIA POST
    const postPrompt = `
Write ONE finished social media post for this local business.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Service or offer: ${service}
Extra details: ${extraDetails}

Rules:
- Output ONLY the finished social media post.
- Do not explain your answer.
- Do not give a breakdown.
- Do not say "here is your post".
- Use natural British English.
- Include a strong opening line.
- Include a clear call to action.
- Include exactly 5 relevant hashtags.
- Suitable for Facebook and Instagram.
- Do not invent prices.
- Do not invent phone numbers.
- Do not invent awards or claims.
`;

    const textResponse = await context.env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct-fast",
      {
        prompt: postPrompt
      }
    );

    const post =
      textResponse.response ||
      textResponse.result ||
      "";

    // CREATE SIMPLE, SAFE IMAGE PROMPT
    const safeBusinessType = businessType
      .replace(/[^\w\s-]/g, "")
      .slice(0, 80);

    const safeService = service
      .replace(/[^\w\s-]/g, "")
      .slice(0, 100);

    const safeLocation = location
      .replace(/[^\w\s-]/g, "")
      .slice(0, 60);

    const imagePrompt = `
Professional commercial photograph for a ${safeBusinessType} business.

Show the service: ${safeService}.

Location style: ${safeLocation || "United Kingdom"}.

Clean, realistic, professional advertising photography.
Square composition for social media.
No text.
No logos.
No prices.
No phone numbers.
No watermarks.
`;

    let image = "";

    try {
      const imageResponse = await context.env.AI.run(
        "@cf/black-forest-labs/flux-1-schnell",
        {
          prompt: imagePrompt,
          steps: 4
        }
      );

      if (imageResponse && imageResponse.image) {
        image =
          `data:image/jpeg;charset=utf-8;base64,${imageResponse.image}`;
      }

    } catch (imageError) {
      console.log("Image generation failed:", imageError.message);
    }

    return Response.json({
      success: true,
      result: post,
      image: image,
      imageGenerated: image !== ""
    });

  } catch (error) {
    console.log("Generation error:", error.message);

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
