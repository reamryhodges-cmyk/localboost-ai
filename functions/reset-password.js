const CURRENT_ITERATIONS = 100000;

export async function onRequestPost({ request, env }) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: "Invalid reset request." }, 400);
    }

    const token = String(body.token || "").trim();
    const password = String(body.password || "");

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return json({ success: false, error: "This reset link is invalid or expired." }, 400);
    }

    if (password.length < 8 || password.length > 200) {
      return json(
        { success: false, error: "Password must be between 8 and 200 characters." },
        400
      );
    }

    if (!env.DB) {
      return json({ success: false, error: "Password reset is unavailable." }, 503);
    }

    const tokenHash = await sha256(token);
    const reset = await env.DB.prepare(`
      SELECT id, user_id, expires_at
      FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL
      LIMIT 1
    `).bind(tokenHash).first();

    if (
      !reset ||
      !reset.expires_at ||
      new Date(reset.expires_at).getTime() <= Date.now()
    ) {
      return json({ success: false, error: "This reset link is invalid or expired." }, 400);
    }

    const passwordHash = await hashPassword(password);

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE users SET password_hash = ? WHERE id = ?
      `).bind(passwordHash, reset.user_id),
      env.DB.prepare(`
        UPDATE password_reset_tokens
        SET used_at = CURRENT_TIMESTAMP
        WHERE id = ? AND used_at IS NULL
      `).bind(reset.id),
      env.DB.prepare(`
        DELETE FROM sessions WHERE user_id = ?
      `).bind(reset.user_id)
    ]);

    return json({
      success: true,
      message: "Password updated. You can now log in."
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return json(
      { success: false, error: "Password reset could not be completed." },
      500
    );
  }
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: CURRENT_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return `pbkdf2-sha256$${CURRENT_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}
