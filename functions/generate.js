
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
You are writing a finished social media post for a UK local business.

Return ONLY the final customer-ready post.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Service or offer: ${service}
Extra details: ${extraDetails}

Requirements:
- Use natural British English.
- Strong opening line.
- Mention the service clearly.
- Include a clear call to action.
- Include exactly 5 relevant hashtags.
- Suitable for Facebook and Instagram.
- Keep it concise and professional.
- Do not invent prices.
- Do not invent phone numbers.
- Do not invent awards.
- Do not invent logos or branding.
- Do not use excessive punctuation.
- Do not use excessive capitalisation.
- Do not explain your answer.
- Do not include steps.
- Do not include headings.
- Do not include analysis.
- Do not include notes.
- Do not repeat these instructions.

Your response must begin immediately with the finished social media post and end after the fifth hashtag.
`;

    const textResponse = await context.env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct-fast",
      {
        prompt: postPrompt,
        max_tokens: 220
      }
    );

    let post =
      textResponse.response ||
      textResponse.result ||
      "";

    // CLEAN UP UNWANTED MODEL EXPLANATIONS
    if (post.includes("---")) {
      post = post.split("---")[0];
    }

    if (post.includes("## Step")) {
      post = post.split("## Step")[0];
    }

    post = post.trim();

    // CREATE SAFE IMAGE PROMPT
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
