const GENERIC_MESSAGE =
  "If that account exists, a password reset link has been sent.";

export async function onRequestPost({ request, env }) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: "Invalid reset request." }, 400);
    }

    const email = String(body.email || "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      return json({ success: true, message: GENERIC_MESSAGE });
    }

    if (!env.DB || !env.RESEND_API_KEY) {
      console.error("Password reset configuration is incomplete.");
      return json(
        { success: false, error: "Password reset is temporarily unavailable." },
        503
      );
    }

    await ensureTable(env.DB);

    const user = await env.DB.prepare(`
      SELECT id FROM users
      WHERE LOWER(email) = ?
      LIMIT 1
    `).bind(email).first();

    if (!user) {
      return json({ success: true, message: GENERIC_MESSAGE });
    }

    const recent = await env.DB.prepare(`
      SELECT id FROM password_reset_tokens
      WHERE user_id = ?
        AND used_at IS NULL
        AND created_at >= datetime('now', '-5 minutes')
      LIMIT 1
    `).bind(user.id).first();

    if (recent) {
      return json({ success: true, message: GENERIC_MESSAGE });
    }

    const token = bytesToHex(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const tokenHash = await sha256(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await env.DB.prepare(`
      UPDATE password_reset_tokens
      SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND used_at IS NULL
    `).bind(user.id).run();

    await env.DB.prepare(`
      INSERT INTO password_reset_tokens
        (user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).bind(user.id, tokenHash, expiresAt).run();

    const resetUrl =
      `https://localboost4u.co.uk/reset-password.html#token=${token}`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "LocalBoost AI <hello@localboost4u.co.uk>",
        to: [email],
        reply_to: "support@localboost4u.co.uk",
        subject: "Reset your LocalBoost AI password",
        text:
          `Reset your LocalBoost AI password using this secure link:\n\n${resetUrl}\n\n` +
          "This link expires in 30 minutes. If you did not request it, ignore this email.",
        html:
          `<p>Reset your LocalBoost AI password using the secure link below.</p>` +
          `<p><a href="${resetUrl}">Reset my password</a></p>` +
          `<p>This link expires in 30 minutes. If you did not request it, ignore this email.</p>`
      })
    });

    if (!response.ok) {
      console.error("Password reset email was rejected by the email service.");
      return json(
        { success: false, error: "Password reset is temporarily unavailable." },
        502
      );
    }

    return json({ success: true, message: GENERIC_MESSAGE });
  } catch (error) {
    console.error("Forgot password error:", error);
    return json(
      { success: false, error: "Password reset is temporarily unavailable." },
      500
    );
  }
}

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_user
    ON password_reset_tokens (user_id, created_at)
  `).run();
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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
