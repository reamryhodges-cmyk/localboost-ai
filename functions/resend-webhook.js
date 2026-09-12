const SIGNATURE_TOLERANCE_SECONDS = 300;

const SUPPRESSION_EVENTS = new Set([
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed"
]);

export async function onRequestPost({ request, env }) {
  try {
    if (!env.RESEND_WEBHOOK_SECRET) {
      console.error("RESEND_WEBHOOK_SECRET is missing.");

      return text(
        "Webhook secret not configured.",
        500
      );
    }

    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return text(
        "Missing webhook signature headers.",
        400
      );
    }

    const rawBody = await request.text();

    const valid = await verifySvixSignature({
      payload: rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      secret: env.RESEND_WEBHOOK_SECRET
    });

    if (!valid) {
      return text(
        "Invalid webhook signature.",
        400
      );
    }

    const alreadyProcessed = await env.DB.prepare(`
      SELECT id
      FROM email_events
      WHERE svix_id = ?
      LIMIT 1
    `)
      .bind(svixId)
      .first();

    if (alreadyProcessed) {
      return json({
        success: true,
        duplicate: true
      });
    }

    let event;

    try {
      event = JSON.parse(rawBody);
    } catch {
      return text(
        "Invalid JSON payload.",
        400
      );
    }

    const eventType = clean(
      event?.type,
      100
    );

    const emailId = clean(
      event?.data?.email_id,
      200
    );

    const businessName = clean(
      event?.data?.tags?.business_name,
      200
    );

    const recipients = getRecipients(event);
    const primaryEmail = recipients[0] || "";

    const details = buildEventDetails(event);

    try {
      await env.DB.prepare(`
        INSERT INTO email_events (
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
          emailId || null,
          primaryEmail || null,
          eventType || "unknown",
          businessName || null,
          details,
          svixId
        )
        .run();

    } catch (error) {
      const message = String(
        error?.message || error
      );

      if (
        message
          .toLowerCase()
          .includes("unique")
      ) {
        return json({
          success: true,
          duplicate: true
        });
      }

      throw error;
    }

    if (SUPPRESSION_EVENTS.has(eventType)) {
      for (const email of recipients) {
        await addSuppression(
          env,
          email,
          eventType,
          emailId
        );
      }
    }

    return json({
      success: true,
      eventType,
      recipientsProcessed: recipients.length
    });

  } catch (error) {
    console.error(
      "Resend webhook error:",
      error
    );

    return text(
      "Webhook processing failed.",
      500
    );
  }
}


async function addSuppression(
  env,
  email,
  eventType,
  emailId
) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return;
  }

  const reason = suppressionReason(eventType);

  const source = emailId
    ? `resend:${emailId}`
    : "resend";

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
      normalizedEmail,
      reason,
      source
    )
    .run();
}


function suppressionReason(eventType) {
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


function getRecipients(event) {
  const to = event?.data?.to;

  if (Array.isArray(to)) {
    return [
      ...new Set(
        to
          .map(normalizeEmail)
          .filter(Boolean)
      )
    ];
  }

  const single = normalizeEmail(to);

  return single ? [single] : [];
}


function buildEventDetails(event) {
  try {
    const details = {
      subject: event?.data?.subject || null,
      bounce: event?.data?.bounce || null,
      failed: event?.data?.failed || null,
      suppressed: event?.data?.suppressed || null,
      created_at:
        event?.created_at ||
        event?.data?.created_at ||
        null
    };

    return JSON.stringify(details).slice(0, 5000);

  } catch {
    return "";
  }
}


async function verifySvixSignature({
  payload,
  svixId,
  svixTimestamp,
  svixSignature,
  secret
}) {
  const timestamp = Number(svixTimestamp);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    Math.abs(now - timestamp) >
    SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  let secretBase64 = String(secret || "").trim();

  if (!secretBase64) {
    return false;
  }

  if (secretBase64.startsWith("whsec_")) {
    secretBase64 = secretBase64.slice(6);
  }

  let secretBytes;

  try {
    secretBytes = base64ToBytes(secretBase64);
  } catch {
    return false;
  }

  const signedContent =
    `${svixId}.${svixTimestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const calculatedBuffer =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedContent)
    );

  const calculatedSignature = bytesToBase64(
    new Uint8Array(calculatedBuffer)
  );

  const suppliedSignatures = String(svixSignature)
    .split(" ")
    .map(value => value.trim())
    .filter(Boolean);

  for (const signature of suppliedSignatures) {
    const parts = signature.split(",");

    if (
      parts.length !== 2 ||
      parts[0] !== "v1"
    ) {
      continue;
    }

    if (
      constantTimeEqual(
        parts[1],
        calculatedSignature
      )
    ) {
      return true;
    }
  }

  return false;
}


function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(
    String(left)
  );

  const b = new TextEncoder().encode(
    String(right)
  );

  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}


function base64ToBytes(value) {
  const binary = atob(value);

  const bytes = new Uint8Array(
    binary.length
  );

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}


function bytesToBase64(bytes) {
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(
      bytes[i]
    );
  }

  return btoa(binary);
}


function normalizeEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return "";
  }

  return email.slice(0, 320);
}


function clean(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    }
  );
}


function text(message, status = 200) {
  return new Response(
    message,
    {
      status,
      headers: {
        "Content-Type":
          "text/plain; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    }
  );
    }
