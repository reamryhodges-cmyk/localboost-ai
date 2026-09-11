export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    const password = String(body.password || "");
    const businessName = String(body.businessName || "").trim();

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

    if (!email.includes("@")) {
      return Response.json(
        {
          error: "Please enter a valid email address."
        },
        {
          status: 400
        }
      );
    }

    if (password.length < 8) {
      return Response.json(
        {
          error: "Password must be at least 8 characters."
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

    // Check whether the account already exists
    const existingUser = await context.env.DB
      .prepare(
        "SELECT id FROM users WHERE email = ?"
      )
      .bind(email)
      .first();

    if (existingUser) {
      return Response.json(
        {
          error: "An account with this email already exists."
        },
        {
          status: 409
        }
      );
    }

    // Create a random password salt
    const salt = crypto.getRandomValues(
      new Uint8Array(16)
    );

    // Convert the password into secure key material
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    // Securely hash the password
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

    const saltArray =
      Array.from(salt);

    const passwordHash =
      saltArray
        .map(byte =>
          byte.toString(16).padStart(2, "0")
        )
        .join("") +
      ":" +
      hashArray
        .map(byte =>
          byte.toString(16).padStart(2, "0")
        )
        .join("");

    // Save the customer
    const result = await context.env.DB
      .prepare(`
        INSERT INTO users
        (
          email,
          password_hash,
          business_name,
          plan,
          generations_used
        )
        VALUES (?, ?, ?, 'free', 0)
      `)
      .bind(
        email,
        passwordHash,
        businessName
      )
      .run();

    return Response.json({
      success: true,
      message: "Account created successfully.",
      userId: result.meta.last_row_id
    });

  } catch (error) {
    console.log(
      "Signup error:",
      error.message
    );

    return Response.json(
      {
        error: "Something went wrong creating the account.",
        details: error.message
      },
      {
        status: 500
      }
    );
  }
}
