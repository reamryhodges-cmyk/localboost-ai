function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

async function verifyStripeSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts = signatureHeader.split(",");

  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const [key, value] = part.split("=");

    if (key === "t") {
      timestamp = value;
    }

    if (key === "v1") {
      signatures.push(value);
    }
  }

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  // Reject webhook messages older than 5 minutes.
  const age = Math.abs(
    Math.floor(Date.now() / 1000) - Number(timestamp)
  );

  if (!Number.isFinite(age) || age > 300) {
    return false;
  }

  const signedPayload =
    timestamp + "." + payload;

  const encoder = new TextEncoder();

  const cryptoKey =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(signedPayload)
    );

  const expectedSignature =
    Array.from(new Uint8Array(signature))
      .map(byte =>
        byte.toString(16).padStart(2, "0")
      )
      .join("");

  return signatures.some(
    sig => sig === expectedSignature
  );
}

async function updateUserPlan(
  env,
  userId,
  plan,
  customerId,
  subscriptionId,
  status
) {
  if (!userId) {
    return;
  }

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
      customerId || null,
      subscriptionId || null,
      status || null,
      userId
    )
    .run();
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.DB) {
      return json(
        { error: "Database is not configured." },
        500
      );
    }

    if (!env.STRIPE_WEBHOOK_SECRET) {
      return json(
        { error: "Webhook secret is not configured." },
        500
      );
    }

    const rawBody = await request.text();

    const stripeSignature =
      request.headers.get("Stripe-Signature");

    const validSignature =
      await verifyStripeSignature(
        rawBody,
        stripeSignature,
        env.STRIPE_WEBHOOK_SECRET
      );

    if (!validSignature) {
      return json(
        { error: "Invalid Stripe signature." },
        400
      );
    }

    let event;

    try {
      event = JSON.parse(rawBody);
    } catch {
      return json(
        { error: "Invalid webhook payload." },
        400
      );
    }

    const object =
      event?.data?.object;

    if (!object) {
      return json({ received: true });
    }

    if (
      event.type ===
      "checkout.session.completed"
    ) {
      const userId =
        object.client_reference_id ||
        object.metadata?.user_id;

      let plan =
        object.metadata?.plan;

      // Standardise old "growth" name
      // to the website's "business" plan.
      if (plan === "growth") {
        plan = "business";
      }

      if (
        userId &&
        ["starter", "business", "pro"].includes(plan)
      ) {
        await updateUserPlan(
          env,
          userId,
          plan,
          object.customer,
          object.subscription,
          "active"
        );
      }
    }

    if (
      event.type ===
      "customer.subscription.updated"
    ) {
      const userId =
        object.metadata?.user_id;

      let plan =
        object.metadata?.plan;

      if (plan === "growth") {
        plan = "business";
      }

      const activeStatuses = [
        "active",
        "trialing"
      ];

      const planToSave =
        activeStatuses.includes(object.status)
          ? plan
          : "unpaid";

      if (userId) {
        await updateUserPlan(
          env,
          userId,
          planToSave,
          object.customer,
          object.id,
          object.status
        );
      }
    }

    if (
      event.type ===
      "customer.subscription.deleted"
    ) {
      const userId =
        object.metadata?.user_id;

      if (userId) {
        await updateUserPlan(
          env,
          userId,
          "unpaid",
          object.customer,
          object.id,
          "cancelled"
        );
      }
    }

    return json({
      received: true
    });

  } catch (error) {
    console.error(
      "Stripe webhook error:",
      error
    );

    return json(
      {
        error:
          "Webhook processing failed."
      },
      500
    );
  }
}
