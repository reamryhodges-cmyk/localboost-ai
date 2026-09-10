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
Create ONE finished social media post for this local business.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Service or offer: ${service}
Extra details: ${extraDetails}

RULES:
- Output ONLY the finished social media post.
- Keep it concise.
- Do not explain the post.
- Do not provide a breakdown.
- Do not say "here is your post".
- Use natural British English.
- Include a strong opening line.
- Include a clear call to action.
- Include exactly 5 relevant hashtags.
- Make it suitable for Facebook and Instagram.
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

    // CREATE MATCHING PICTURE
    const imagePrompt = `
Create a realistic professional square social media advertising image.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Service or offer: ${service}
Extra details: ${extraDetails}

IMAGE RULES:
- Realistic professional photography.
- Square social media composition.
- High quality.
- Modern commercial advertising style.
- Make the image relevant to the business.
- Make the image relevant to the service being advertised.
- No written text.
- No logos.
- No phone numbers.
- No prices.
- No watermarks.
`;

    const imageResponse = await context.env.AI.run(
      "@cf/black-forest-labs/flux-1-schnell",
      {
        prompt: imagePrompt,
        steps: 4
      }
    );

    let image = "";

    if (imageResponse && imageResponse.image) {
      image =
        `data:image/jpeg;charset=utf-8;base64,${imageResponse.image}`;
    }

    return Response.json({
      success: true,
      result: post,
      image: image,
      imageGenerated: image !== ""
    });

  } catch (error) {
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
