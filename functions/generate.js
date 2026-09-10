export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const businessName = body.businessName || "";
    const businessType = body.businessType || "";
    const location = body.location || "";
    const service = body.service || "";
    const extraDetails = body.extraDetails || "";

    if (!context.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "OPENAI_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const prompt = `
You are an AI marketing assistant for UK local businesses.

Create professional marketing content using the information below.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Service: ${service}
Extra details: ${extraDetails}

Use clear, natural British English.
Do not invent prices, awards, contact details or claims.

Return useful customer-ready marketing content.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${context.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5.4-mini",
          input: prompt,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        {
          error: "OpenAI request failed.",
          details: data,
        },
        { status: response.status }
      );
    }

    return Response.json({
      success: true,
      result: data.output_text || "",
    });
  } catch (error) {
    return Response.json(
      {
        error: "Something went wrong.",
        details: error.message,
      },
      { status: 500 }
    );
  }
}
