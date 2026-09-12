const SUPPRESSION_EVENTS = new Set([
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed"
]);

const SIGNATURE_TOLERANCE_SECONDS = 300;

export async function onRequestPost({ request, env }) {
  let stage = "start";

  try {
    stage = "checking bindings";

    if (!env.DB) {
      throw new Error("DB binding is missing");
    }

    if (!env.RESEND_WEBHOOK_SECRET) {
      throw new Error(
        "RESEND_WEBHOOK_SECRET is missing"
      );
    }

    stage = "reading webhook headers";

    const webhookId =
      request.headers.get("svix-id");

    const timestamp =
      request.headers.get("svix-timestamp");

    const signature =
      request.headers.get("svix-signature");

    if (
      !webhookId ||
      !timestamp ||
      !signature
    ) {
      return json(
        {
          success: false,
          error: "Missing webhook signature headers"
        },
        400
      );
    }

    stage = "reading request body";

    const rawBody = await request.text();

    stage = "verifying signature";

    let verified = false;

    try {
      verified =
        await verifyWebhook({
          rawBody,
          webhookId,
          timestamp,
          signature,
          secret:
            env.RESEND_WEBHOOK_SECRET
        });
    } catch (error) {
      console.error(
        "Webhook verification error:",
        error
      );

      return json(
        {
          success: false,
          error: "Webhook verification failed"
        },
        400
      );
    }

    if (!verified) {
      return json(
        {
          success: false,
          error: "Invalid webhook signature"
        },
        400
      );
    }

    stage = "parsing event";

    let event;

    try {
      event = JSON.parse(rawBody);
    } catch {
      return json(
        {
          success: false,
          error: "Invalid JSON"
        },
        400
      );
    }

    const eventType =
      clean(event?.type, 100) ||
      "unknown";

    const resendEmailId =
      clean(
        event?.data?.email_id ||
        event?.data?.id,
        200
      );

    const recipients =
      getRecipients(event);

    const email =
      recipients[0] || null;

    const details =
      JSON.stringify({
        created_at:
          event?.created_at || null,

        subject:
          event?.data?.subject || null,

        bounce:
          event?.data?.bounce || null,

        failed:
          event?.data?.failed || null,

        suppressed:
          event?.data?.suppressed || null
      }).slice(0, 5000);

    stage = "recording event";

    /*
      INSERT OR IGNORE means Resend can safely
      retry the same webhook without creating
      duplicate rows.
    */

    await env.DB.prepare(`
      INSERT OR IGNORE INTO email_events (
        resend_email_id,
        email,
        event_type,
        business_name,
        details,
        svix_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(
        resendEmailId || null,
        email,
        eventType,
        null,
        details,
        webhookId
      )
      .run();

    stage = "adding suppression";

    if (
      SUPPRESSION_EVENTS.has(eventType)
    ) {
      for (const recipient of recipients) {
        await env.DB.prepare(`
          INSERT INTO suppression_list (
            email,
            reason,
            source
          )
          VALUES (?, ?, ?)

          ON CONFLICT(email)
          DO UPDATE SET
            reason = excluded.reason,
            source = excluded.source
        `)
          .bind(
            recipient,
            getSuppressionReason(
              eventType
            ),
            resendEmailId
              ? `resend:${resendEmailId}`
              : "resend"
          )
          .run();
      }
    }

    stage = "complete";

    return json({
      success: true,
      eventType,
      recipients,
      suppressed:
        SUPPRESSION_EVENTS.has(
          eventType
        )
    });

  } catch (error) {
    console.error(
      `Resend webhook failed at stage: ${stage}`,
      error
    );

    return json(
      {
        success: false,
        error:
          "Webhook processing failed",
        stage
      },
      500
    );
  }
}


async function verifyWebhook({
  rawBody,
  webhookId,
  timestamp,
  signature,
  secret
}) {
  const timestampNumber =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampNumber
    )
  ) {
    return false;
  }

  const currentTime =
    Math.floor(Date.now() / 1000);

  if (
    Math.abs(
      currentTime -
      timestampNumber
    ) >
    SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  let secretValue =
    String(secret || "").trim();

  if (
    secretValue.startsWith(
      "whsec_"
    )
  ) {
    secretValue =
      secretValue.substring(6);
  }

  if (!secretValue) {
    return false;
  }

  const keyBytes =
    decodeBase64(secretValue);

  const signingKey =
    await crypto.subtle.importKey(
      "raw",
      keyBytes,
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const signedPayload =
    `${webhookId}.${timestamp}.${rawBody}`;

  const calculated =
    await crypto.subtle.sign(
      "HMAC",
      signingKey,
      new TextEncoder().encode(
        signedPayload
      )
    );

  const calculatedSignature =
    encodeBase64(
      new Uint8Array(calculated)
    );

  const supplied =
    String(signature)
      .split(/\s+/)
      .filter(Boolean);

  for (const item of supplied) {
    const separator =
      item.indexOf(",");

    if (separator === -1) {
      continue;
    }

    const version =
      item.substring(
        0,
        separator
      );

    const value =
      item.substring(
        separator + 1
      );

    if (
      version === "v1" &&
      safeCompare(
        value,
        calculatedSignature
      )
    ) {
      return true;
    }
  }

  return false;
}


function getRecipients(event) {
  let values =
    event?.data?.to;

  if (!values) {
    values =
      event?.data?.email;
  }

  if (!Array.isArray(values)) {
    values = values
      ? [values]
      : [];
  }

  return [
    ...new Set(
      values
        .map(normalizeEmail)
        .filter(Boolean)
    )
  ];
}


function normalizeEmail(value) {
  const email =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(email)
  ) {
    return "";
  }

  return email.slice(0, 320);
}


function getSuppressionReason(
  eventType
) {
  switch (eventType) {
    case "email.bounced":
      return "bounce";

    case "email.complained":
      return "complaint";

    case "email.failed":
      return "failed";

    case "email.suppressed":
      return "resend_suppressed";

    default:
      return "blocked";
  }
}


function decodeBase64(value) {
  let base64 =
    String(value)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  while (
    base64.length % 4 !== 0
  ) {
    base64 += "=";
  }

  const decoded =
    atob(base64);

  const bytes =
    new Uint8Array(
      decoded.length
    );

  for (
    let i = 0;
    i < decoded.length;
    i++
  ) {
    bytes[i] =
      decoded.charCodeAt(i);
  }

  return bytes;
}


function encodeBase64(bytes) {
  let value = "";

  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {
    value +=
      String.fromCharCode(
        bytes[i]
      );
  }

  return btoa(value);
}


function safeCompare(a, b) {
  const left =
    new TextEncoder().encode(
      String(a)
    );

  const right =
    new TextEncoder().encode(
      String(b)
    );

  if (
    left.length !==
    right.length
  ) {
    return false;
  }

  let difference = 0;

  for (
    let i = 0;
    i < left.length;
    i++
  ) {
    difference |=
      left[i] ^ right[i];
  }

  return difference === 0;
}


function clean(
  value,
  maxLength
) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}


function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}
