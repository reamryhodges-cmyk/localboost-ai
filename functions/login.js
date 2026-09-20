export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    const password = String(body.password || "");

    if (!email || !password) {
      return Response.json(
        {
          error: "Email and password are required."
        },
        {
          status: 400
        }
      );
    }

    if (!context.env.DB) {
      console.error("Login configuration error: DB binding missing.");
      return Response.json(
        {
          error: "Login is temporarily unavailable."
        },
        {
          status: 500
        }
      );
    }

    const user = await context.env.DB
      .prepare(`
        SELECT
          id,
          email,
          password_hash,
          business_name,
          plan,
          generations_used
        FROM users
        WHERE email = ?
      `)
      .bind(email)
      .first();

    if (!user) {
      return Response.json(
        {
          error: "Invalid email or password."
        },
        {
          status: 401
        }
      );
    }

    const verification = await verifyPassword(
      password,
      user.password_hash
    );

    if (!verification.valid) {
      return Response.json(
        {
          error: "Invalid email or password."
        },
        {
          status: 401
        }
      );
    }

    if (verification.needsUpgrade) {
      const upgradedHash = await hashPassword(password);
      await context.env.DB.prepare(`
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
      `).bind(upgradedHash, user.id).run();
    }

    // Remove old sessions for this user
    await context.env.DB
      .prepare(
        "DELETE FROM sessions WHERE user_id = ?"
      )
      .bind(user.id)
      .run();

    // Create a secure random session token
    const tokenBytes =
      crypto.getRandomValues(
        new Uint8Array(32)
      );

    const token =
      Array.from(tokenBytes)
        .map(byte =>
          byte.toString(16).padStart(2, "0")
        )
        .join("");

    // Session lasts 7 days
    const expiresAt =
      new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString();

    await context.env.DB
      .prepare(`
        INSERT INTO sessions
        (
          user_id,
          token,
          expires_at
        )
        VALUES (?, ?, ?)
      `)
      .bind(
        user.id,
        token,
        expiresAt
      )
      .run();

    return new Response(
      JSON.stringify({
        success: true,
        message: "Login successful.",
        user: {
          id: user.id,
          email: user.email,
          businessName: user.business_name,
          plan: user.plan,
          generationsUsed: user.generations_used
        }
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie":
            `localboost_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
        }
      }
    );

  } catch (error) {
    console.error("Login error:", error);

    return Response.json(
      {
        error: "Something went wrong logging in."
      },
      {
        status: 500
      }
    );
  }
}

const CURRENT_ITERATIONS = 210000;

async function verifyPassword(password, storedValue) {
  const stored = String(storedValue || "");
  let iterations;
  let saltHex;
  let savedHashHex;
  let needsUpgrade = false;

  if (stored.startsWith("pbkdf2-sha256$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return { valid: false, needsUpgrade: false };
    iterations = Number(parts[1]);
    saltHex = parts[2];
    savedHashHex = parts[3];
    needsUpgrade = iterations < CURRENT_ITERATIONS;
  } else {
    const parts = stored.split(":");
    if (parts.length !== 2) return { valid: false, needsUpgrade: false };
    iterations = 100000;
    saltHex = parts[0];
    savedHashHex = parts[1];
    needsUpgrade = true;
  }

  if (
    !Number.isInteger(iterations) ||
    iterations < 100000 ||
    iterations > 1000000 ||
    !/^[a-f0-9]{32}$/i.test(saltHex) ||
    !/^[a-f0-9]{64}$/i.test(savedHashHex)
  ) {
    return { valid: false, needsUpgrade: false };
  }

  const derived = await derivePasswordHash(password, saltHex, iterations);
  return {
    valid: timingSafeEqualHex(derived, savedHashHex),
    needsUpgrade
  };
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(salt);
  const hashHex = await derivePasswordHash(
    password,
    saltHex,
    CURRENT_ITERATIONS
  );
  return `pbkdf2-sha256$${CURRENT_ITERATIONS}$${saltHex}$${hashHex}`;
}

async function derivePasswordHash(password, saltHex, iterations) {
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function timingSafeEqualHex(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function hexToBytes(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
