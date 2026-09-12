const LIVE_PRICES = {
  starter: "price_1UEoIZDimtpKMVhGrJ5HCNy5",
  business: "price_1UEoKpDimtpKMVhGFwStptK4",
  pro: "price_1UEoLJDimtpKMVhGfUHQcaRk",
};

const SANDBOX_PRICES = {
  starter: "price_1UEqEDDwvLIba56zbxz8vqWh",
  business: "price_1UEqGrDwvLIba56zFDFTA51O",
  pro: "price_1UEqHKDwvLIba56ze80OnSFB",
};

const SANDBOX_TEST_EMAIL = "samtest1109@example.com";

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
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
  const { request, env } = context;

  try {
    if (!env.DB) {
      return jsonResponse(
        { error: "Database is not configured." },
        500
      );
    }

    const sessionToken = getCookie(request, "localboost_session");

    if (!sessionToken) {
      return jsonResponse(
        { error: "Please log in before choosing a plan." },
        401
      );
    }

    const session = await env.DB.prepare(`
      SELECT
        sessions.user_id,
        sessions.expires_at,
        users.email,
        users.business_name,
        users.plan
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ?
      LIMIT 1
    `)
      .bind(sessionToken)
      .first();

    if (!session) {
      return jsonResponse(
        { error: "Your login session is not valid. Please log in again." },
        401
      );
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await env.DB.prepare(`
        DELETE FROM sessions
        WHERE token = ?
      `)
        .bind(sessionToken)
        .run();

      return jsonResponse(
        { error: "Your login session has expired. Please log in again." },
        401
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "Invalid checkout request." },
        400
      );
    }

    let plan = String(body.plan || "")
      .trim()
      .toLowerCase();

    // Backwards compatibility if the website still sends "growth".
    if (plan === "growth") {
      plan = "business";
    }

    if (!["starter", "business", "pro"].includes(plan)) {
      return jsonResponse(
        { error: "Invalid subscription plan." },
        400
      );
    }

    const requestedMode =
      String(body.mode || "")
        .trim()
        .toLowerCase() === "sandbox"
        ? "sandbox"
        : "live";

    let stripeSecret;
    let priceId;
    let checkoutMode = "live";

    if (requestedMode === "sandbox") {
      // Sandbox checkout is deliberately restricted to your test account.
      if (
        String(session.email || "").toLowerCase() !==
        SANDBOX_TEST_EMAIL.toLowerCase()
      ) {
        return jsonResponse(
          { error: "Sandbox checkout is not available for this account." },
          403
        );
      }

      if (!env.STRIPE_SANDBOX_SECRET_KEY) {
        return jsonResponse(
          { error: "Sandbox Stripe key is not configured." },
          500
        );
      }

      stripeSecret = env.STRIPE_SANDBOX_SECRET_KEY;
      priceId = SANDBOX_PRICES[plan];
      checkoutMode = "sandbox";
    } else {
      stripeSecret =
        env.STRIPE_SECRET_KEY ||
        env.STRIPE_SECRET_KEY1;

      if (!stripeSecret) {
        return jsonResponse(
          { error: "Stripe is not configured." },
          500
        );
      }

      priceId = LIVE_PRICES[plan];
    }

    if (!stripeSecret.startsWith("sk_")) {
      return jsonResponse(
        { error: "Stripe secret key is invalid." },
        500
      );
    }

    const requestUrl = new URL(request.url);
    const siteOrigin = requestUrl.origin;

    const successUrl =
      `${siteOrigin}/?checkout=success&plan=${encodeURIComponent(plan)}`;

    const cancelUrl =
      `${siteOrigin}/?checkout=cancelled`;

    const stripeBody = new URLSearchParams();

    stripeBody.append("mode", "subscription");

    stripeBody.append(
      "line_items[0][price]",
      priceId
    );

    stripeBody.append(
      "line_items[0][quantity]",
      "1"
    );

    stripeBody.append(
      "success_url",
      successUrl
    );

    stripeBody.append(
      "cancel_url",
      cancelUrl
    );

    stripeBody.append(
      "customer_email",
      session.email
    );

    stripeBody.append(
      "client_reference_id",
      String(session.user_id)
    );

    // Metadata on the Checkout Session.
    stripeBody.append(
      "metadata[user_id]",
      String(session.user_id)
    );

    stripeBody.append(
      "metadata[plan]",
      plan
    );

    stripeBody.append(
      "metadata[checkout_mode]",
      checkoutMode
    );

    // Metadata copied onto the actual Stripe subscription.
    stripeBody.append(
      "subscription_data[metadata][user_id]",
      String(session.user_id)
    );

    stripeBody.append(
      "subscription_data[metadata][plan]",
      plan
    );

    stripeBody.append(
      "subscription_data[metadata][checkout_mode]",
      checkoutMode
    );

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body: stripeBody.toString(),
      }
    );

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error(
        "Stripe checkout error:",
        JSON.stringify(stripeData)
      );

      return jsonResponse(
        {
          error:
            stripeData?.error?.message ||
            "Stripe could not create the checkout session.",
        },
        stripeResponse.status || 500
      );
    }

    if (!stripeData.url) {
      return jsonResponse(
        { error: "Stripe did not return a checkout URL." },
        500
      );
    }

    return jsonResponse({
      success: true,
      url: stripeData.url,
      mode: checkoutMode,
      plan,
    });
  } catch (error) {
    console.error(
      "create-checkout-session error:",
      error
    );

    return jsonResponse(
      { error: "Unable to start checkout." },
      500
    );
  }
}

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
