export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();

    const businessName = data.businessName || "";
    const businessType = data.businessType || "";
    const location = data.location || "";
    const offer = data.offer || "";

    if (!businessName) {
      return new Response(
        JSON.stringify({ error: "Business name is required." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const prompt = `
Create a professional social media post for a UK small business.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Offer or service: ${offer}

Include:
- A strong headline
- A short Facebook/Instagram post
- A clear call to action
- 5 relevant hashtags

Use natural British English.
Do not invent prices, awards, claims or contact details.
`;

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: prompt
      })
    });

    const result = await aiResponse.json();

    if (!aiResponse.ok) {
      return new Response(
        JSON.stringify({ error: "AI generation failed." }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        content: result.output_text
      }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Something went wrong." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
