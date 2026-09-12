const VALID_PAID_PLANS = ["starter", "business", "pro"];

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.DB) {
      return response("Database is not configured.", 500);
    }

    const signatureHeader = request.headers.get("stripe-signature");

    if (!signatureHeader) {
      return response("Missing Stripe signature.", 400);
    }

    // IMPORTANT:
    // Stripe signatures must be checked against the exact raw request body.
    const rawBody = await request.text();

    const liveSecret = env.STRIPE_WEBHOOK_SECRET;
    const sandboxSecret = env.STRIPE_SANDBOX_WEBHOOK_SECRET;

    let verifiedMode = null;

    if (
      liveSecret &&
      await verifyStripeSignature(
        rawBody,
        signatureHeader,
        liveSecret
      )
    ) {
      verifiedMode = "live";
    }

    if (
      !verifiedMode &&
      sandboxSecret &&
      await verifyStripeSignature(
        rawBody,
        signatureHeader,
        sandboxSecret
      )
    ) {
      verifiedMode = "sandbox";
    }

    if (!verifiedMode) {
      console.error("Stripe webhook signature verification failed.");

      return response(
        "Invalid Stripe signature.",
        400
      );
    }

    let event;

    try {
      event = JSON.parse(rawBody);
    } catch {
      return response("Invalid JSON.", 400);
    }

    console.log(
      `Stripe ${verifiedMode} webhook: ${event.type}`
    );

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          env,
          event.data.object
        );
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          env,
          event.data.object
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          env,
          event.data.object
        );
        break;

      default:
        console.log(
          `Ignoring Stripe event: ${event.type}`
        );
    }

    return response("Webhook received.", 200);
  } catch (error) {
    console.error("Stripe webhook error:", error);

    return response(
      "Webhook processing failed.",
      500
    );
  }
}

async function handleCheckoutCompleted(env, session) {
  const userId =
    session?.metadata?.user_id ||
    session?.client_reference_id;

  const plan = normalisePlan(
    session?.metadata?.plan
  );

  if (!userId) {
    console.error(
      "Checkout completed without a LocalBoost user ID."
    );
    return;
  }

  if (!VALID_PAID_PLANS.includes(plan)) {
    console.error(
      `Checkout completed with invalid plan: ${plan}`
    );
    return;
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || null;

  await env.DB.prepare(`
    UPDATE users
    SET
      plan = ?,
      stripe_customer_id = ?,
      stripe_subscription_id = ?,
      subscription_status = ?
    WHERE id = ?
  `)
    .bind(
      plan,
      customerId,
      subscriptionId,
      "active",
      Number(userId)
    )
    .run();

  console.log(
    `Activated ${plan} for LocalBoost user ${userId}.`
  );
}

async function handleSubscriptionUpdated(
  env,
  subscription
) {
  const status = String(
    subscription?.status || ""
  ).toLowerCase();

  const userId =
    subscription?.metadata?.user_id || null;

  const metadataPlan = normalisePlan(
    subscription?.metadata?.plan
  );

  const subscriptionId =
    subscription?.id || null;

  const customerId =
    typeof subscription?.customer === "string"
      ? subscription.customer
      : subscription?.customer?.id || null;

  const user = await findUser(
    env,
    userId,
    subscriptionId,
    customerId
  );

  if (!user) {
    console.error(
      `No LocalBoost user found for subscription ${subscriptionId}.`
    );
    return;
  }

  const subscriptionHasAccess =
    status === "active" ||
    status === "trialing";

  let newPlan = "free";

  if (subscriptionHasAccess) {
    if (VALID_PAID_PLANS.includes(metadataPlan)) {
      newPlan = metadataPlan;
    } else if (
      VALID_PAID_PLANS.includes(
        normalisePlan(user.plan)
      )
    ) {
      newPlan = normalisePlan(user.plan);
    }
  }

  await env.DB.prepare(`
    UPDATE users
    SET
      plan = ?,
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_subscription_id = COALESCE(?, stripe_subscription_id),
      subscription_status = ?
    WHERE id = ?
  `)
    .bind(
      newPlan,
      customerId,
      subscriptionId,
      status || "unknown",
      user.id
    )
    .run();

  console.log(
    `Updated LocalBoost user ${user.id}: plan=${newPlan}, status=${status}.`
  );
}

async function handleSubscriptionDeleted(
  env,
  subscription
) {
  const userId =
    subscription?.metadata?.user_id || null;

  const subscriptionId =
    subscription?.id || null;

  const customerId =
    typeof subscription?.customer === "string"
      ? subscription.customer
      : subscription?.customer?.id || null;

  const user = await findUser(
    env,
    userId,
    subscriptionId,
    customerId
  );

  if (!user) {
    console.error(
      `No LocalBoost user found for deleted subscription ${subscriptionId}.`
    );
    return;
  }

  await env.DB.prepare(`
    UPDATE users
    SET
      plan = 'free',
      subscription_status = 'canceled'
    WHERE id = ?
  `)
    .bind(user.id)
    .run();

  console.log(
    `Canceled subscription for LocalBoost user ${user.id}.`
  );
}

async function findUser(
  env,
  userId,
  subscriptionId,
  customerId
) {
  if (userId) {
    const byId = await env.DB.prepare(`
      SELECT
        id,
        plan,
        stripe_customer_id,
        stripe_subscription_id
      FROM users
      WHERE id = ?
      LIMIT 1
    `)
      .bind(Number(userId))
      .first();

    if (byId) {
      return byId;
    }
  }

  if (subscriptionId) {
    const bySubscription =
      await env.DB.prepare(`
        SELECT
          id,
          plan,
          stripe_customer_id,
          stripe_subscription_id
        FROM users
        WHERE stripe_subscription_id = ?
        LIMIT 1
      `)
        .bind(subscriptionId)
        .first();

    if (bySubscription) {
      return bySubscription;
    }
  }

  if (customerId) {
    const byCustomer =
      await env.DB.prepare(`
        SELECT
          id,
          plan,
          stripe_customer_id,
          stripe_subscription_id
        FROM users
        WHERE stripe_customer_id = ?
        LIMIT 1
      `)
        .bind(customerId)
        .first();

    if (byCustomer) {
      return byCustomer;
    }
  }

  return null;
}

function normalisePlan(plan) {
  const value = String(plan || "")
    .trim()
    .toLowerCase();

  // Old LocalBoost checkout used "growth".
  if (value === "growth") {
    return "business";
  }

  return value;
}

async function verifyStripeSignature(
  payload,
  signatureHeader,
  secret
) {
  try {
    const parts = signatureHeader.split(",");

    let timestamp = null;
    const signatures = [];

    for (const part of parts) {
      const [key, value] = part.trim().split("=");

      if (key === "t") {
        timestamp = value;
      }

      if (key === "v1") {
        signatures.push(value);
      }
    }

    if (
      !timestamp ||
      signatures.length === 0
    ) {
      return false;
    }

    // Reject webhook messages older than 5 minutes.
    const timestampNumber = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);

    if (
      !Number.isFinite(timestampNumber) ||
      Math.abs(now - timestampNumber) > 300
    ) {
      return false;
    }

    const signedPayload =
      `${timestamp}.${payload}`;

    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );

    const signatureBuffer =
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signedPayload)
      );

    const expectedSignature =
      bufferToHex(signatureBuffer);

    return signatures.some(
      (signature) =>
        timingSafeEqual(
          expectedSignature,
          signature
        )
    );
  } catch (error) {
    console.error(
      "Signature verification error:",
      error
    );

    return false;
  }
}

function timingSafeEqual(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |=
      a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return difference === 0;
}

function bufferToHex(buffer) {
  return Array.from(
    new Uint8Array(buffer)
  )
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

function response(message, status = 200) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type":
        "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
