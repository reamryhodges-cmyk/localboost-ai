const PRICES = {
  starter: "price_1UEoIZDimtpKMVhGrJ5HCNy5",
  growth: "price_1UEoKpDimtpKMVhGFwStptK4",
  business: "price_1UEoKpDimtpKMVhGFwStptK4",
  pro: "price_1UEoLJDimtpKMVhGfUHQcaRk"
};

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === name) {
      return valueParts.join("=");
    }
  }

  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // Check required Cloudflare bindings
    if (!env.DB) {
      return json(
        { error: "Database is not configured." },
        500
      );
    }

    // IMPORTANT:
    // Cloudflare secret must be named exactly:
    // STRIPE_SECRET_KEY
    const stripeSecretKey = env.STRIPE_SECRET_KEY;

    if (
      !stripeSecretKey ||
      typeof stripeSecretKey !== "string" ||
      !stripeSecretKey.startsWith("sk_")
    ) {
      return json(
        { error: "Stripe secret key is missing or invalid." },
        500
      );
    }

    // Check login session
    const cookieHeader = request.headers.get("Cookie");
    const token = getCookie(
      cookieHeader,
      "localboost_session"
    );

    if (!token) {
      return json(
        { error: "Please log in before choosing a plan." },
        401
      );
    }

    // Find logged-in user
    const session = await env.DB.prepare(`
      SELECT
        users.id,
        users.email,
        users.business_name,
        users.plan,
        sessions.expires_at
      FROM sessions
      JOIN users
        ON users.id = sessions.user_id
      WHERE sessions.token = ?
      LIMIT 1
    `)
      .bind(token)
      .first();

    if (!session) {
      return json(
        { error: "Your login session is invalid. Please log in again." },
        401
      );
    }

    // Check session expiry
    if (
      session.expires_at &&
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      return json(
        { error: "Your login session has expired. Please log in again." },
        401
      );
    }

    // Read requested plan
    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        { error: "Invalid request." },
        400
      );
    }

    const plan = String(body.plan || "")
      .trim()
      .toLowerCase();

    const priceId = PRICES[plan];

    if (!priceId) {
      return json(
        { error: "Please choose a valid plan." },
        400
      );
    }

    // Stripe requires form encoded data
    const form = new URLSearchParams();

    form.append("mode", "subscription");
    form.append("line_items[0][price]", priceId);
    form.append("line_items[0][quantity]", "1");

    form.append(
      "success_url",
      "https://localboost-bdr.pages.dev/?payment=success&session_id={CHECKOUT_SESSION_ID}"
    );

    form.append(
      "cancel_url",
      "https://localboost-bdr.pages.dev/?payment=cancelled"
    );

    form.append(
      "client_reference_id",
      String(session.id)
    );

    form.append(
      "metadata[user_id]",
      String(session.id)
    );

    form.append(
      "metadata[plan]",
      plan === "growth" ? "business" : plan
    );

    if (session.email) {
      form.append(
        "customer_email",
        session.email
      );
    }

    // Create Stripe Checkout Session
    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      }
    );

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error(
        "Stripe Checkout error:",
        stripeData
      );

      return json(
        {
          error:
            stripeData?.error?.message ||
            "Stripe could not create the checkout."
        },
        500
      );
    }

    if (!stripeData.url) {
      return json(
        { error: "Stripe did not return a checkout URL." },
        500
      );
    }

    return json({
      success: true,
      checkoutUrl: stripeData.url
    });

  } catch (error) {
    console.error(
      "Create checkout error:",
      error
    );

    return json(
      {
        error:
          error?.message ||
          "Something went wrong creating the checkout."
      },
      500
    );
  }
}
