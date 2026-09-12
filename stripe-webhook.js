function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function hexToUint8Array(hex) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(
      hex.substr(i * 2, 2),
      16
    );
  }

  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

async function verifyStripeSignature(
  payload,
  signatureHeader,
  secret
) {
  if (
    !payload ||
    !signatureHeader ||
    !secret
  ) {
    return false;
  }

  const parts =
    signatureHeader.split(",");

  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const [key, value] =
      part.split("=");

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

  const signedPayload =
    `${timestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const expectedSignatureBuffer =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        signedPayload
      )
    );

  const expectedSignature =
    new Uint8Array(
      expectedSignatureBuffer
    );

  for (const signature of signatures) {
    try {
      const receivedSignature =
        hexToUint8Array(signature);

      if (
        timingSafeEqual(
          expectedSignature,
          receivedSignature
        )
      ) {
        return true;
      }
    } catch {
      // Ignore bad signature format
    }
  }

  return false;
}

function normalizePlan(plan) {
  if (plan === "growth") {
    return "business";
  }

  if (
    plan === "starter" ||
    plan === "business" ||
    plan === "pro"
  ) {
    return plan;
  }

  return null;
}

async function updateSubscriptionFromObject(
  env,
  subscription
) {
  const userId =
    subscription?.metadata?.user_id;

  const plan =
    normalizePlan(
      subscription?.metadata?.plan
    );

  if (!userId) {
    return;
  }

  const status =
    subscription.status || null;

  const activeStatuses = [
    "active",
    "trialing"
  ];

  const newPlan =
    activeStatuses.includes(status) && plan
      ? plan
      : "unpaid";

  const currentPeriodEnd =
    subscription.current_period_end
      ? new Date(
          subscription.current_period_end * 1000
        ).toISOString()
      : null;

  await env.DB.prepare(`
    UPDATE users
    SET
      plan = ?,
      stripe_customer_id = ?,
      stripe_subscription_id = ?,
      subscription_status = ?,
      current_period_end = ?
    WHERE id = ?
  `)
    .bind(
      newPlan,
      subscription.customer
        ? String(subscription.customer)
        : null,
      subscription.id
        ? String(subscription.id)
        : null,
      status,
      currentPeriodEnd,
      Number(userId)
    )
    .run();
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

    if (!env.STRIPE_WEBHOOK_SECRET) {
      return json(
        {
          error:
            "Stripe webhook secret is not configured."
        },
        500
      );
    }

    const rawBody =
      await request.text();

    const signatureHeader =
      request.headers.get(
        "Stripe-Signature"
      );

    const valid =
      await verifyStripeSignature(
        rawBody,
        signatureHeader,
        env.STRIPE_WEBHOOK_SECRET
      );

    if (!valid) {
      return json(
        {
          error:
            "Invalid Stripe signature."
        },
        400
      );
    }

    let event;

    try {
      event =
        JSON.parse(rawBody);
    } catch {
      return json(
        {
          error:
            "Invalid webhook payload."
        },
        400
      );
    }

    if (
      event.type ===
      "checkout.session.completed"
    ) {
      const session =
        event.data.object;

      const userId =
        session.client_reference_id ||
        session.metadata?.user_id;

      const plan =
        normalizePlan(
          session.metadata?.plan
        );

      if (userId && plan) {
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
            session.customer
              ? String(session.customer)
              : null,
            session.subscription
              ? String(session.subscription)
              : null,
            "active",
            Number(userId)
          )
          .run();
      }
    }

    if (
      event.type ===
      "customer.subscription.updated"
    ) {
      await updateSubscriptionFromObject(
        env,
        event.data.object
      );
    }

    if (
      event.type ===
      "customer.subscription.deleted"
    ) {
      const subscription =
        event.data.object;

      const userId =
        subscription?.metadata?.user_id;

      if (userId) {
        await env.DB.prepare(`
          UPDATE users
          SET
            plan = 'unpaid',
            subscription_status = ?,
            current_period_end = NULL
          WHERE id = ?
        `)
          .bind(
            subscription.status ||
            "canceled",
            Number(userId)
          )
          .run();
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
