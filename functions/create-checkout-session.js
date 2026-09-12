const PRICES = {
  starter: "price_1UEoIZDimtpKMVhGrJ5HCNy5",
  growth: "price_1UEoKpDimtpKMVhGFwStptK4",
  pro: "price_1UEoLJDimtpKMVhGfUHQcaRk"
};

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const cookies =
    cookieHeader.split(";");

  for (const cookie of cookies) {
    const parts =
      cookie.trim().split("=");

    const key =
      parts.shift();

    const value =
      parts.join("=");

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

function getStripeSecret(env) {
  const possibleKeys = [
    env.STRIPE_SECRET_KEY,
    env.STRIPE_SECRET_KEY1
  ];

  for (const key of possibleKeys) {
    if (
      typeof key === "string" &&
      key.trim().startsWith("sk_")
    ) {
      return key.trim();
    }
  }

  return null;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.DB) {
      return json(
        {
          error:
            "Database is not configured."
        },
        500
      );
    }

    const stripeSecretKey =
      getStripeSecret(env);

    if (!stripeSecretKey) {
      return json(
        {
          error:
            "Stripe secret key is missing or invalid."
        },
        500
      );
    }

    const sessionToken =
      getCookie(
        request.headers.get("Cookie"),
        "localboost_session"
      );

    if (!sessionToken) {
      return json(
        {
          error:
            "Please log in before choosing a plan."
        },
        401
      );
    }

    const user =
      await env.DB.prepare(`
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
      .bind(sessionToken)
      .first();

    if (!user) {
      return json(
        {
          error:
            "Your login session is invalid. Please log in again."
        },
        401
      );
    }

    if (
      !user.expires_at ||
      new Date(user.expires_at).getTime()
        <= Date.now()
    ) {
      await env.DB.prepare(`
        DELETE FROM sessions
        WHERE token = ?
      `)
      .bind(sessionToken)
      .run();

      return json(
        {
          error:
            "Your login session has expired. Please log in again."
        },
        401
      );
    }

    let body;

    try {
      body =
        await request.json();
    } catch {
      return json(
        {
          error:
            "Invalid checkout request."
        },
        400
      );
    }

    const plan =
      String(
        body.plan || ""
      ).toLowerCase();

    const priceId =
      PRICES[plan];

    if (!priceId) {
      return json(
        {
          error:
            "Invalid plan selected."
        },
        400
      );
    }

    const origin =
      new URL(request.url).origin;

    const stripeBody =
      new URLSearchParams();

    stripeBody.set(
      "mode",
      "subscription"
    );

    stripeBody.set(
      "line_items[0][price]",
      priceId
    );

    stripeBody.set(
      "line_items[0][quantity]",
      "1"
    );

    stripeBody.set(
      "customer_email",
      user.email
    );

    stripeBody.set(
      "client_reference_id",
      String(user.id)
    );

    stripeBody.set(
      "metadata[user_id]",
      String(user.id)
    );

    stripeBody.set(
      "metadata[plan]",
      plan
    );

    stripeBody.set(
      "subscription_data[metadata][user_id]",
      String(user.id)
    );

    stripeBody.set(
      "subscription_data[metadata][plan]",
      plan
    );

    stripeBody.set(
      "success_url",
      origin +
      "/?payment=success"
    );

    stripeBody.set(
      "cancel_url",
      origin +
      "/?payment=cancelled"
    );

    const stripeResponse =
      await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method: "POST",

          headers: {
            "Authorization":
              "Bearer " +
              stripeSecretKey,

            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          body:
            stripeBody.toString()
        }
      );

    const stripeText =
      await stripeResponse.text();

    let stripeData = {};

    try {
      stripeData =
        JSON.parse(stripeText);
    } catch {
      return json(
        {
          error:
            "Stripe returned an invalid response."
        },
        500
      );
    }

    if (!stripeResponse.ok) {
      return json(
        {
          error:
            stripeData?.error?.message ||
            "Stripe could not create checkout."
        },
        stripeResponse.status || 500
      );
    }

    if (!stripeData.url) {
      return json(
        {
          error:
            "Stripe did not return a checkout URL."
        },
        500
      );
    }

    return json({
      success: true,
      checkoutUrl:
        stripeData.url
    });

  } catch (error) {
    console.error(
      "Checkout error:",
      error
    );

    return json(
      {
        error:
          "Something went wrong creating checkout."
      },
      500
    );
  }
}
