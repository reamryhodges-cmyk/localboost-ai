const PRICES = {
  starter: "price_1UEoIZDimtpKMVhGrJ5HCNy5",
  growth: "price_1UEoKpDimtpKMVhGFwStptK4",
  pro: "price_1UEoLJDimtpKMVhGfUHQcaRk",
};

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.DB) {
      return Response.json(
        { error: "Database is not configured." },
        { status: 500 }
      );
    }

    if (!env.STRIPE_SECRET_KEY) {
      return Response.json(
        { error: "Stripe is not configured." },
        { status: 500 }
      );
    }

    const sessionToken = getCookie(
      request.headers.get("Cookie"),
      "localboost_session"
    );

    if (!sessionToken) {
      return Response.json(
        { error: "Please log in first." },
        { status: 401 }
      );
    }

    const user = await env.DB.prepare(`
      SELECT
        users.id,
        users.email,
        users.business_name,
        users.plan,
        sessions.expires_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ?
      LIMIT 1
    `)
      .bind(sessionToken)
      .first();

    if (!user) {
      return Response.json(
        { error: "Your login session is invalid." },
        { status: 401 }
      );
    }

    if (new Date(user.expires_at).getTime() <= Date.now()) {
      await env.DB.prepare(`
        DELETE FROM sessions
        WHERE token = ?
      `)
        .bind(sessionToken)
        .run();

      return Response.json(
        { error: "Your login session has expired. Please log in again." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const plan = String(body.plan || "").toLowerCase();

    if (!PRICES[plan]) {
      return Response.json(
        { error: "Invalid plan selected." },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const siteOrigin = url.origin;

    const stripeBody = new URLSearchParams();

    stripeBody.append("mode", "subscription");
    stripeBody.append("line_items[0][price]", PRICES[plan]);
    stripeBody.append("line_items[0][quantity]", "1");

    stripeBody.append(
      "success_url",
      `${siteOrigin}/?payment=success`
    );

    stripeBody.append(
      "cancel_url",
      `${siteOrigin}/?payment=cancelled`
    );

    stripeBody.append(
      "client_reference_id",
      String(user.id)
    );

    stripeBody.append(
      "customer_email",
      user.email
    );

    stripeBody.append(
      "metadata[user_id]",
      String(user.id)
    );

    stripeBody.append(
      "metadata[plan]",
      plan
    );

    stripeBody.append(
      "subscription_data[metadata][user_id]",
      String(user.id)
    );

    stripeBody.append(
      "subscription_data[metadata][plan]",
      plan
    );

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: stripeBody.toString(),
      }
    );

    const stripeSession = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error("Stripe error:", stripeSession);

      return Response.json(
        {
          error:
            stripeSession?.error?.message ||
            "Stripe could not create the checkout session.",
        },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      checkoutUrl: stripeSession.url,
    });
  } catch (error) {
    console.error("Checkout error:", error);

    return Response.json(
      { error: "Something went wrong creating checkout." },
      { status: 500 }
    );
  }
}
