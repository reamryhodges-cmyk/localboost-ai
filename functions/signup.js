export async function onRequestPost(context) {
  try {
    let body;

    try {
      body = await context.request.json();
    } catch {
      return Response.json(
        {
          error: "Invalid signup request."
        },
        {
          status: 400
        }
      );
    }

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    const password = String(body.password || "");

    const businessName = String(
      body.businessName || ""
    )
      .trim()
      .slice(0, 150);

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

    if (!isValidEmail(email)) {
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

    if (password.length > 200) {
      return Response.json(
        {
          error: "Password is too long."
        },
        {
          status: 400
        }
      );
    }

    if (!context.env.DB) {
      console.error(
        "Signup configuration error: DB binding missing."
      );

      return Response.json(
        {
          error:
            "Account creation is temporarily unavailable."
        },
        {
          status: 500
        }
      );
    }

    const existingUser = await context.env.DB
      .prepare(`
        SELECT id
        FROM users
        WHERE email = ?
        LIMIT 1
      `)
      .bind(email)
      .first();

    if (existingUser) {
      return Response.json(
        {
          error:
            "An account with this email already exists."
        },
        {
          status: 409
        }
      );
    }

    const salt = crypto.getRandomValues(
      new Uint8Array(16)
    );

    const keyMaterial =
      await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
      );

    const hashBuffer =
      await crypto.subtle.deriveBits(
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
      Array.from(
        new Uint8Array(hashBuffer)
      );

    const saltArray =
      Array.from(salt);

    const passwordHash =
      saltArray
        .map(byte =>
          byte
            .toString(16)
            .padStart(2, "0")
        )
        .join("") +
      ":" +
      hashArray
        .map(byte =>
          byte
            .toString(16)
            .padStart(2, "0")
        )
        .join("");

    const result =
      await context.env.DB
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

    return Response.json(
      {
        success: true,
        message:
          "Account created successfully.",
        userId:
          result?.meta?.last_row_id ||
          null
      },
      {
        status: 201
      }
    );

  } catch (error) {
    console.error(
      "Signup error:",
      error
    );

    return Response.json(
      {
        error:
          "Something went wrong creating the account."
      },
      {
        status: 500
      }
    );
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value
  );
}
