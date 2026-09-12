const ADMIN_EMAIL = "samtest1109@example.com";

const MAX_RESULTS = 100;

/*
  Businesses we DO want.

  The finder checks the company name,
  domain, industry, description and other
  Hunter metadata for these terms.
*/
const TARGET_KEYWORDS = [
  "valet",
  "valeting",
  "detailing",
  "detailer",
  "car wash",
  "carwash",

  "cleaner",
  "cleaners",
  "cleaning",
  "window cleaning",
  "carpet cleaning",
  "pressure washing",

  "barber",
  "barbers",
  "hair",
  "hairdresser",
  "hairdressing",
  "salon",

  "beauty",
  "nail",
  "nails",
  "aesthetic",
  "aesthetics",
  "spa",
  "massage",

  "dog groom",
  "groomer",
  "grooming",
  "pet grooming",

  "landscape",
  "landscaping",
  "gardener",
  "gardening",
  "garden services",

  "plumber",
  "plumbing",

  "electrician",
  "electrical",

  "builder",
  "builders",
  "building services",
  "roofer",
  "roofing",
  "decorator",
  "decorating",
  "painting",
  "handyman",

  "cafe",
  "café",
  "coffee shop",
  "restaurant",
  "takeaway",
  "bakery",
  "food",
  "catering",

  "gym",
  "fitness",
  "personal trainer",
  "personal training",
  "yoga",
  "pilates",
  "martial arts",

  "photographer",
  "photography",

  "garage",
  "mot",
  "tyres",
  "tyre",
  "vehicle repair",
  "car repair",

  "florist",
  "flowers",

  "tattoo",

  "wedding",
  "event hire"
];


/*
  Organisations we definitely DON'T want.
*/
const BLOCKED_KEYWORDS = [
  "university",
  "college",
  "school",
  "academy",

  "council",
  "government",
  "gov.uk",
  "nhs",
  "hospital",

  "charity",
  "foundation",
  "trust",
  "association",
  "federation",
  "institute",

  "bank",
  "banking",
  "financial",
  "finance",
  "investment",
  "insurance",

  "software",
  "saas",
  "technology",
  "technologies",
  "cyber",
  "telecom",

  "consulting",
  "consultancy",
  "consultants",

  "engineering",
  "engineers",

  "recruitment",
  "staffing",

  "legal services",
  "solicitors",
  "law firm",

  "accountancy",
  "accountants",

  "manufacturer",
  "manufacturing",

  "wholesale",
  "wholesaler",

  "industrial",

  "global",
  "international",

  "holdings",
  "corporation",
  "corporate",

  "public limited",
  " plc",

  "property investment",
  "venture capital",

  "research organisation",
  "research institute"
];


/*
  Domains that should never be approached.
*/
const BLOCKED_DOMAIN_PARTS = [
  ".gov.uk",
  ".ac.uk",
  ".nhs.uk",
  "gov.uk",
  "parliament.uk"
];


export async function onRequestPost({
  request,
  env
}) {
  try {

    /*
      =============================
      ADMIN AUTH
      =============================
    */

    const token = getCookie(
      request.headers.get("Cookie") || "",
      "localboost_session"
    );


    if (!token) {
      return json(
        {
          success: false,
          error: "Please log in."
        },
        401
      );
    }


    const session =
      await env.DB.prepare(`
        SELECT
          s.expires_at,
          u.email
        FROM sessions s
        JOIN users u
          ON u.id = s.user_id
        WHERE s.token = ?
        LIMIT 1
      `)
        .bind(token)
        .first();


    if (!session) {
      return json(
        {
          success: false,
          error: "Invalid session."
        },
        401
      );
    }


    if (
      session.expires_at &&
      new Date(
        session.expires_at
      ).getTime() <= Date.now()
    ) {
      return json(
        {
          success: false,
          error:
            "Session expired. Please log in again."
        },
        401
      );
    }


    if (
      String(session.email || "")
        .trim()
        .toLowerCase() !==
      ADMIN_EMAIL
    ) {
      return json(
        {
          success: false,
          error: "Admin access only."
        },
        403
      );
    }


    /*
      =============================
      HUNTER CONFIG
      =============================
    */

    if (!env.HUNTER_API_KEY) {
      return json(
        {
          success: false,
          error:
            "Hunter API is not configured."
        },
        500
      );
    }


    let body = {};

    try {
      body =
        await request.json();
    } catch {
      body = {};
   
