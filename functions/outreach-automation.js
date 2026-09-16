const ADMIN_EMAIL = "samtest1109@example.com";

const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_BATCH_SIZE = 10;

const ALLOWED_BUSINESS_TYPES = [
  "Car Valeting",
  "Plumbers",
  "Electricians",
  "Hair Salons",
  "Beauty Salons",
  "Landscaping"
];

export async function onRequest({ request, env }) {
  try {
    if (!env.DB) {
      return json(
        {
          success: false,
          error: "Database is not configured."
        },
        500
      );
    }

    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
      return auth.response;
    }

    if (request.method === "GET") {
      return getSettings(env);
    }

    if (request.method === "POST") {
      return updateSettings(request, env);
    }

    return json(
      {
        success: false,
        error: "Method not allowed."
      },
      405
    );
  } catch (error) {
    console.error("Outreach automation error:", error);

    return json(
      {
        success: false,
        error: "Could not process outreach automation settings."
      },
      500
    );
  }
}

async function getSettings(env) {
  await ensureSettingsRow(env);

  const settings = await env.DB.prepare(`
    SELECT
      enabled,
      daily_limit,
      batch_size,
      business_type,
      last_run_at,
      created_at,
      updated_at
    FROM outreach_automation
    ORDER BY id ASC
    LIMIT 1
  `).first();

  return json({
    success: true,
    settings: {
      enabled: Number(settings?.enabled || 0) === 1,
      dailyLimit: clamp(
        Number(settings?.daily_limit || DEFAULT_DAILY_LIMIT),
        1,
        DEFAULT_DAILY_LIMIT
      ),
      batchSize: clamp(
        Number(settings?.batch_size || DEFAULT_BATCH_SIZE),
        1,
        DEFAULT_BATCH_SIZE
      ),
      businessType: normaliseBusinessType(
        settings?.business_type || "mixed"
      ),
      lastRunAt: settings?.last_run_at || null,
      updatedAt: settings?.updated_at || null
    }
  });
}

async function updateSettings(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        success: false,
        error: "Invalid request."
      },
      400
    );
  }

  await ensureSettingsRow(env);

  const current = await env.DB.prepare(`
    SELECT
      enabled,
      daily_limit,
      batch_size,
      business_type
    FROM outreach_automation
    ORDER BY id ASC
    LIMIT 1
  `).first();

  let enabled =
    Number(current?.enabled || 0) === 1;

  let dailyLimit = clamp(
    Number(current?.daily_limit || DEFAULT_DAILY_LIMIT),
    1,
    DEFAULT_DAILY_LIMIT
  );

  let batchSize = clamp(
    Number(current?.batch_size || DEFAULT_BATCH_SIZE),
    1,
    DEFAULT_BATCH_SIZE
  );

  let businessType = normaliseBusinessType(
    current?.business_type || "mixed"
  );

  if (typeof body.enabled === "boolean") {
    enabled = body.enabled;
  }

  if (body.dailyLimit !== undefined) {
    const requestedDailyLimit = Number(body.dailyLimit);

    if (
      !Number.isInteger(requestedDailyLimit) ||
      requestedDailyLimit < 1 ||
      requestedDailyLimit > DEFAULT_DAILY_LIMIT
    ) {
      return json(
        {
          success: false,
          error:
            `Daily limit must be between 1 and ${DEFAULT_DAILY_LIMIT}.`
        },
        400
      );
    }

    dailyLimit = requestedDailyLimit;
  }

  if (body.batchSize !== undefined) {
    const requestedBatchSize = Number(body.batchSize);

    if (
      !Number.isInteger(requestedBatchSize) ||
      requestedBatchSize < 1 ||
      requestedBatchSize > DEFAULT_BATCH_SIZE
    ) {
      return json(
        {
          success: false,
          error:
            `Batch size must be between 1 and ${DEFAULT_BATCH_SIZE}.`
        },
        400
      );
    }

    batchSize = requestedBatchSize;
  }

  if (body.businessType !== undefined) {
    businessType =
      normaliseBusinessType(body.businessType);

    if (!businessType) {
      return json(
        {
          success: false,
          error: "Invalid business type."
        },
        400
      );
    }
  }

  if (batchSize > dailyLimit) {
    batchSize = dailyLimit;
  }

  await env.DB.prepare(`
    UPDATE outreach_automation
    SET
      enabled = ?,
      daily_limit = ?,
      batch_size = ?,
      business_type = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT id
      FROM outreach_automation
      ORDER BY id ASC
      LIMIT 1
    )
  `)
    .bind(
      enabled ? 1 : 0,
      dailyLimit,
      batchSize,
      businessType
    )
    .run();

  return json({
    success: true,
    message: enabled
      ? "AI outreach automation settings saved."
      : "AI outreach automation is switched off.",
    settings: {
      enabled,
      dailyLimit,
      batchSize,
      businessType
    }
  });
}

async function ensureSettingsRow(env) {
  await env.DB.prepare(`
    INSERT INTO outreach_automation (
      enabled,
      daily_limit,
      batch_size,
      business_type
    )
    SELECT
      0,
      ?,
      ?,
      'mixed'
    WHERE NOT EXISTS (
      SELECT 1
      FROM outreach_automation
    )
  `)
    .bind(
      DEFAULT_DAILY_LIMIT,
      DEFAULT_BATCH_SIZE
    )
    .run();
}

function normaliseBusinessType(value) {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  if (text.toLowerCase() === "mixed") {
    return "mixed";
  }

  const match = ALLOWED_BUSINESS_TYPES.find(
    item =>
      item.toLowerCase() === text.toLowerCase()
  );

  return match || null;
}

async function requireAdmin(request, env) {
  const token = getCookie(
    request.headers.get("Cookie") || "",
    "localboost_session"
  );

  if (!token) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "Please log in."
        },
        401
      )
    };
  }

  const user = await env.DB.prepare(`
    SELECT
      u.id,
      u.email,
      s.expires_at
    FROM sessions s
    JOIN users u
      ON u.id = s.user_id
    WHERE s.token = ?
    LIMIT 1
  `)
    .bind(token)
    .first();

  if (!user) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "Invalid session."
        },
        401
      )
    };
  }

  if (
    user.expires_at &&
    new Date(user.expires_at).getTime() <= Date.now()
  ) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "Session expired."
        },
        401
      )
    };
  }

  if (
    String(user.email || "")
      .trim()
      .toLowerCase() !== ADMIN_EMAIL.toLowerCase()
  ) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "Admin access required."
        },
        403
      )
    };
  }

  return {
    ok: true,
    user
  };
}

function getCookie(cookieHeader, name) {
  const cookies =
    String(cookieHeader || "").split(";");

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key =
      cookie.slice(0, separator).trim();

    if (key !== name) {
      continue;
    }

    return decodeURIComponent(
      cookie.slice(separator + 1).trim()
    );
  }

  return null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(min, Math.trunc(value))
  );
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
    }
