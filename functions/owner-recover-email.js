const RECOVERY_TOKEN_HASH =
  "bff012a4dc9962a9a75f2a5dccc0d766bf7fe0be9b0ed37ef5c3cbf7c7b8379e";

const LOCKED_ACCOUNT_EMAIL =
  "samtest1109@example.com";

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ success: false, error: "Recovery is unavailable." }, 503);
    }

    const suppliedToken =
      String(request.headers.get("X-Recovery-Token") || "");

    if (
      suppliedToken.length !== 64 ||
      !/^[a-f0-9]+$/i.test(suppliedToken)
    ) {
      return json({ success: false, error: "Recovery request rejected." }, 403);
    }

    const suppliedHash = await sha256(suppliedToken);

    if (!constantTimeEqual(suppliedHash, RECOVERY_TOKEN_HASH)) {
      return json({ success: false, error: "Recovery request rejected." }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const newEmail = String(body.email || "").trim().toLowerCase();

    if (
      !newEmail ||
      newEmail.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)
    ) {
      return json({ success: false, error: "Enter a valid email address." }, 400);
    }

    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1"
    ).bind(newEmail).first();

    if (existing) {
      return json({ success: false, error: "That email is already in use." }, 409);
    }

    const result = await env.DB.prepare(`
      UPDATE users
      SET email = ?
      WHERE lower(email) = lower(?)
    `).bind(newEmail, LOCKED_ACCOUNT_EMAIL).run();

    const changed = Number(
      result && result.meta && result.meta.changes
        ? result.meta.changes
        : 0
    );

    if (changed !== 1) {
      return json({ success: false, error: "Recovery request is no longer valid." }, 409);
    }

    return json({
      success: true,
      message: "Account email updated. Request a password reset to continue."
    });
  } catch (error) {
    console.error("Owner recovery error:", error);
    return json({ success: false, error: "Recovery could not be completed." }, 500);
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
