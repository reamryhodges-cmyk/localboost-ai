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
        { error: "Workers AI binding is not configured." },
        { status: 500 }
      );
    }

    const prompt = `
Create a professional social media post for a small local business.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Product or service: ${service}
Extra details: ${extraDetails}

Requirements:
- Write one engaging social media post.
- Use natural British English.
- Include a strong opening line.
- Include a clear call to action.
- Add 5 relevant hashtags.
- Make it suitable for Facebook and Instagram.
- Do not invent prices, contact details, awards or claims.
`;

    const aiResponse = await context.env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct-fast",
      {
        prompt: prompt
      }
    );

    const result =
      aiResponse.response ||
      aiResponse.result ||
      "";

    return Response.json({
      success: true,
      result: result
    });

  } catch (error) {
    return Response.json(
      {
        error: "Something went wrong.",
        details: error.message
      },
      { status: 500 }
    );
  }
}
