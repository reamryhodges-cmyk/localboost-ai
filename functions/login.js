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
      return Response.json(
        {
          error: "Database is not connected."
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

    const parts = String(user.password_hash).split(":");

    if (parts.length !== 2) {
      return Response.json(
        {
          error: "Account password data is invalid."
        },
        {
          status: 500
        }
      );
    }

    const saltHex = parts[0];
    const savedHashHex = parts[1];

    const salt = new Uint8Array(
      saltHex.match(/.{1,2}/g).map(
        byte => parseInt(byte, 16)
      )
    );

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );

    const hashArray =
      Array.from(new Uint8Array(hashBuffer));

    const enteredHashHex =
      hashArray
        .map(byte =>
          byte.toString(16).padStart(2, "0")
        )
        .join("");

    if (enteredHashHex !== savedHashHex) {
      return Response.json(
        {
          error: "Invalid email or password."
        },
        {
          status: 401
        }
      );
    }

    return Response.json({
      success: true,
      message: "Login successful.",
      user: {
        id: user.id,
        email: user.email,
        businessName: user.business_name,
        plan: user.plan,
        generationsUsed: user.generations_used
      }
    });

  } catch (error) {
    console.log(
      "Login error:",
      error.message
    );

    return Response.json(
      {
        error: "Something went wrong logging in.",
        details: error.message
      },
      {
        status: 500
      }
    );
  }
}
