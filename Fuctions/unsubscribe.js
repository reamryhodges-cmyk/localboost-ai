export async function onRequest({
  request,
  env
}) {
  try {
    if (!env.DB) {
      return htmlPage(
        "Unavailable",
        "The unsubscribe service is temporarily unavailable.",
        500
      );
    }

    if (!env.UNSUBSCRIBE_SECRET) {
      console.error(
        "UNSUBSCRIBE_SECRET is not configured."
      );

      return htmlPage(
        "Unavailable",
        "The unsubscribe service is temporarily unavailable.",
        500
      );
    }

    const url =
      new URL(request.url);

    const token =
      String(
        url.searchParams.get("token") || ""
      ).trim();

    if (!token) {
      return htmlPage(
        "Invalid link",
        "This unsubscribe link is invalid.",
        400
      );
    }

    const decoded =
      await verifyToken(
        token,
        env.UNSUBSCRIBE_SECRET
      );

    if (!decoded?.email) {
      return htmlPage(
        "Invalid link",
        "This unsubscribe link is invalid or has been altered.",
        400
      );
    }

    const email =
      normalizeEmail(
        decoded.email
      );

    if (!email) {
      return htmlPage(
        "Invalid link",
        "This unsubscribe link is invalid.",
        400
      );
    }

    /*
      A valid signed unsubscribe link is enough
      to place the email address on the permanent
      LocalBoost suppression list.

      INSERT OR IGNORE makes repeated clicks safe.
    */

    await env.DB.prepare(`
      INSERT OR IGNORE INTO suppression_list (
        email,
        reason,
        source
      )
      VALUES (
        ?,
        'unsubscribe',
        'unsubscribe_link'
      )
    `)
      .bind(email)
      .run();

    /*
      In case the table already contains the email
      from another source, make sure it remains
      suppressed and record the unsubscribe reason.
    */

    await env.DB.prepare(`
      UPDATE suppression_list
      SET
        reason = 'unsubscribe',
        source = 'unsubscribe_link'
      WHERE LOWER(email) = LOWER(?)
    `)
      .bind(email)
      .run();

    return htmlPage(
      "Unsubscribed",
      "You have been unsubscribed and LocalBoost AI will not send further outreach emails to this address.",
      200
    );

  } catch (error) {
    console.error(
      "Unsubscribe error:",
      error
    );

    return htmlPage(
      "Something went wrong",
      "We could not process your unsubscribe request. Please try again.",
      500
    );
  }
}


/*
  =====================================
  VERIFY SIGNED UNSUBSCRIBE TOKEN
  =====================================

  Token format:

  base64url(email).base64url(signature)

  Signature:
  HMAC-SHA256(base64url(email))
*/

async function verifyToken(
  token,
  secret
) {
  const parts =
    String(token || "")
      .split(".");

  if (parts.length !== 2) {
    return null;
  }

  const encodedEmail =
    parts[0];

  const suppliedSignature =
    parts[1];

  if (
    !encodedEmail ||
    !suppliedSignature
  ) {
    return null;
  }

  let email;

  try {
    email =
      decodeBase64Url(
        encodedEmail
      );
  } catch {
    return null;
  }

  const normalizedEmail =
    normalizeEmail(
      email
    );

  if (!normalizedEmail) {
    return null;
  }

  const expectedSignature =
    await createSignature(
      encodedEmail,
      secret
    );

  if (
    !timingSafeEqual(
      suppliedSignature,
      expectedSignature
    )
  ) {
    return null;
  }

  return {
    email:
      normalizedEmail
  };
}


/*
  =====================================
  CREATE HMAC SIGNATURE
  =====================================
*/

async function createSignature(
  message,
  secret
) {
  const encoder =
    new TextEncoder();

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(
        String(secret)
      ),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      [
        "sign"
      ]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        String(message)
      )
    );

  return arrayBufferToBase64Url(
    signature
  );
}


/*
  =====================================
  EMAIL VALIDATION
  =====================================
*/

function normalizeEmail(
  value
) {
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

  return email.slice(
    0,
    320
  );
}


/*
  =====================================
  BASE64 URL HELPERS
  =====================================
*/

function decodeBase64Url(
  value
) {
  let base64 =
    String(value || "")
      .replace(
        /-/g,
        "+"
      )
      .replace(
        /_/g,
        "/"
      );

  while (
    base64.length % 4
  ) {
    base64 += "=";
  }

  const binary =
    atob(base64);

  const bytes =
    Uint8Array.from(
      binary,
      character =>
        character.charCodeAt(0)
    );

  return new TextDecoder()
    .decode(bytes);
}


function arrayBufferToBase64Url(
  buffer
) {
  const bytes =
    new Uint8Array(
      buffer
    );

  let binary = "";

  for (
    const byte of bytes
  ) {
    binary +=
      String.fromCharCode(
        byte
      );
  }

  return btoa(binary)
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}


/*
  =====================================
  CONSTANT-TIME STRING COMPARISON
  =====================================
*/

function timingSafeEqual(
  left,
  right
) {
  const a =
    String(left || "");

  const b =
    String(right || "");

  if (
    a.length !==
    b.length
  ) {
    return false;
  }

  let mismatch = 0;

  for (
    let index = 0;
    index < a.length;
    index++
  ) {
    mismatch |=
      a.charCodeAt(index) ^
      b.charCodeAt(index);
  }

  return mismatch === 0;
}


/*
  =====================================
  SAFE HTML RESPONSE
  =====================================
*/

function htmlPage(
  title,
  message,
  status = 200
) {
  const safeTitle =
    escapeHtml(
      title
    );

  const safeMessage =
    escapeHtml(
      message
    );

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <meta
    name="robots"
    content="noindex,nofollow"
  >
  <title>${safeTitle} | LocalBoost AI</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family:
        Arial,
        Helvetica,
        sans-serif;
      background: #f6f7f9;
      color: #1f2937;
    }

    .card {
      width: 100%;
      max-width: 560px;
      background: white;
      border-radius: 16px;
      padding: 32px;
      box-shadow:
        0 10px 30px
        rgba(0, 0, 0, 0.08);
      text-align: center;
    }

    h1 {
      margin:
        0
        0
        16px;
      font-size: 28px;
    }

    p {
      margin:
        0
        0
        24px;
      line-height: 1.6;
      color: #4b5563;
    }

    a {
      display: inline-block;
      text-decoration: none;
      padding:
        12px
        20px;
      border-radius: 10px;
      background: #111827;
      color: white;
      font-weight: 700;
    }
  </style>
</head>

<body>
  <main class="card">
    <h1>${safeTitle}</h1>

    <p>
      ${safeMessage}
    </p>

    <a href="https://localboost4u.co.uk">
      LocalBoost AI
    </a>
  </main>
</body>
</html>
  `.trim();

  return new Response(
    html,
    {
      status,

      headers: {
        "Content-Type":
          "text/html; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


function escapeHtml(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}
