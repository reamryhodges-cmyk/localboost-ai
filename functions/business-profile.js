export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (!env.DB) {
      return json(
        { error: "Database is not configured." },
        500
      );
    }

    const user = await getUser(request, env);

    if (!user) {
      return json(
        { error: "You must be logged in." },
        401
      );
    }

    if (request.method === "GET") {
      return getProfile(env, user);
    }

    if (request.method === "POST") {
      return saveProfile(request, env, user);
    }

    return json(
      { error: "Method not allowed." },
      405
    );
  } catch (error) {
    console.error("Business profile error:", error);

    return json(
      { error: "Business profile request failed." },
      500
    );
  }
}

async function getUser(request, env) {
  const cookie = request.headers.get("Cookie") || "";

  const match = cookie.match(
    /(?:^|;\s*)session=([^;]+)/
  );

  if (!match) {
    return null;
  }

  const sessionToken = decodeURIComponent(match[1]);

  const session = await env.DB
    .prepare(`
      SELECT
        s.user_id,
        s.expires_at,
        u.email,
        u.business_name,
        u.plan
      FROM sessions s
      JOIN users u
        ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `)
    .bind(sessionToken)
    .first();

  if (!session) {
    return null;
  }

  if (
    session.expires_at &&
    new Date(session.expires_at).getTime() < Date.now()
  ) {
    await env.DB
      .prepare(`
        DELETE FROM sessions
        WHERE token = ?
      `)
      .bind(sessionToken)
      .run();

    return null;
  }

  return {
    id: session.user_id,
    email: session.email,
    businessName: session.business_name,
    plan: session.plan
  };
}

async function getProfile(env, user) {
  const profile = await env.DB
    .prepare(`
      SELECT
        user_id,
        business_name,
        business_type,
        description,
        primary_service,
        other_services,
        town_city,
        service_area,
        postcode,
        phone,
        email,
        website,
        facebook_url,
        instagram_url,
        tiktok_url,
        youtube_url,
        default_offer,
        default_call_to_action,
        target_customer,
        brand_tone,
        created_at,
        updated_at
      FROM business_profiles
      WHERE user_id = ?
      LIMIT 1
    `)
    .bind(user.id)
    .first();

  if (!profile) {
    return json({
      profile: null,
      defaults: {
        businessName: user.businessName || "",
        email: user.email || "",
        defaultCallToAction: "Contact us today",
        brandTone: "professional"
      }
    });
  }

  return json({
    profile: mapProfile(profile)
  });
}

async function saveProfile(request, env, user) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      { error: "Invalid request." },
      400
    );
  }

  const businessName = clean(
    body.businessName || user.businessName,
    150
  );

  const businessType = clean(
    body.businessType,
    150
  );

  const description = clean(
    body.description,
    1000
  );

  const primaryService = clean(
    body.primaryService,
    200
  );

  const otherServices = clean(
    body.otherServices,
    1000
  );

  const townCity = clean(
    body.townCity,
    150
  );

  const serviceArea = clean(
    body.serviceArea,
    300
  );

  const postcode = clean(
    body.postcode,
    20
  );

  const phone = clean(
    body.phone,
    40
  );

  const email = clean(
    body.email || user.email,
    320
  );

  const website = cleanUrl(
    body.website,
    500
  );

  const facebookUrl = cleanUrl(
    body.facebookUrl,
    500
  );

  const instagramUrl = cleanUrl(
    body.instagramUrl,
    500
  );

  const tiktokUrl = cleanUrl(
    body.tiktokUrl,
    500
  );

  const youtubeUrl = cleanUrl(
    body.youtubeUrl,
    500
  );

  const defaultOffer = clean(
    body.defaultOffer,
    300
  );

  const defaultCallToAction = clean(
    body.defaultCallToAction || "Contact us today",
    200
  );

  const targetCustomer = clean(
    body.targetCustomer,
    500
  );

  const brandTone = normaliseTone(
    body.brandTone
  );

  if (!businessName) {
    return json(
      { error: "Business name is required." },
      400
    );
  }

  if (email && !isValidEmail(email)) {
    return json(
      { error: "Email address is invalid." },
      400
    );
  }

  await env.DB
    .prepare(`
      INSERT INTO business_profiles (
        user_id,
        business_name,
        business_type,
        description,
        primary_service,
        other_services,
        town_city,
        service_area,
        postcode,
        phone,
        email,
        website,
        facebook_url,
        instagram_url,
        tiktok_url,
        youtube_url,
        default_offer,
        default_call_to_action,
        target_customer,
        brand_tone,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(user_id)
      DO UPDATE SET
        business_name = excluded.business_name,
        business_type = excluded.business_type,
        description = excluded.description,
        primary_service = excluded.primary_service,
        other_services = excluded.other_services,
        town_city = excluded.town_city,
        service_area = excluded.service_area,
        postcode = excluded.postcode,
        phone = excluded.phone,
        email = excluded.email,
        website = excluded.website,
        facebook_url = excluded.facebook_url,
        instagram_url = excluded.instagram_url,
        tiktok_url = excluded.tiktok_url,
        youtube_url = excluded.youtube_url,
        default_offer = excluded.default_offer,
        default_call_to_action = excluded.default_call_to_action,
        target_customer = excluded.target_customer,
        brand_tone = excluded.brand_tone,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(
      user.id,
      businessName,
      businessType,
      description,
      primaryService,
      otherServices,
      townCity,
      serviceArea,
      postcode,
      phone,
      email,
      website,
      facebookUrl,
      instagramUrl,
      tiktokUrl,
      youtubeUrl,
      defaultOffer,
      defaultCallToAction,
      targetCustomer,
      brandTone
    )
    .run();

  const saved = await env.DB
    .prepare(`
      SELECT
        user_id,
        business_name,
        business_type,
        description,
        primary_service,
        other_services,
        town_city,
        service_area,
        postcode,
        phone,
        email,
        website,
        facebook_url,
        instagram_url,
        tiktok_url,
        youtube_url,
        default_offer,
        default_call_to_action,
        target_customer,
        brand_tone,
        created_at,
        updated_at
      FROM business_profiles
      WHERE user_id = ?
      LIMIT 1
    `)
    .bind(user.id)
    .first();

  return json({
    success: true,
    message: "Business profile saved.",
    profile: mapProfile(saved)
  });
}

function mapProfile(row) {
  return {
    userId: row.user_id,
    businessName: row.business_name || "",
    businessType: row.business_type || "",
    description: row.description || "",
    primaryService: row.primary_service || "",
    otherServices: row.other_services || "",
    townCity: row.town_city || "",
    serviceArea: row.service_area || "",
    postcode: row.postcode || "",
    phone: row.phone || "",
    email: row.email || "",
    website: row.website || "",
    facebookUrl: row.facebook_url || "",
    instagramUrl: row.instagram_url || "",
    tiktokUrl: row.tiktok_url || "",
    youtubeUrl: row.youtube_url || "",
    defaultOffer: row.default_offer || "",
    defaultCallToAction:
      row.default_call_to_action ||
      "Contact us today",
    targetCustomer: row.target_customer || "",
    brandTone:
      row.brand_tone ||
      "professional",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function clean(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function cleanUrl(value, maxLength) {
  const url = clean(value, maxLength);

  if (!url) {
    return "";
  }

  if (
    !url.startsWith("https://") &&
    !url.startsWith("http://")
  ) {
    return "";
  }

  return url;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normaliseTone(value) {
  const allowed = [
    "professional",
    "friendly",
    "premium",
    "bold",
    "casual",
    "informative"
  ];

  const tone = String(
    value || "professional"
  )
    .trim()
    .toLowerCase();

  return allowed.includes(tone)
    ? tone
    : "professional";
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
    }
