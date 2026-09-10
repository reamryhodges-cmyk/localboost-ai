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
You are LocalBoost AI.

Create a professional social media marketing post for this UK business.

Business name: ${businessName}
Business type: ${businessType}
Location: ${location}
Offer or service: ${offer}

Include:
- An engaging headline
- A short Facebook and Instagram post
- A clear call to action
- 5 relevant hashtags

Use natural British English.
Do not invent prices, awards, contact details or claims.
`;

    const aiResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body:
