const ADMIN_EMAIL = "samtest1109@example.com";

const BLOCKED_WORDS = [
  "consultancy",
  "consulting",
  "engineer",
  "engineering",
  "university",
  "college",
  "school",
  "academy",
  "charity",
  "foundation",
  "association",
  "federation",
  "institute",
  "council",
  "government",
  "nhs",
  "hospital",
  "bank",
  "financial",
  "finance",
  "investment",
  "insurance",
  "software",
  "technology",
  "recruitment",
  "staffing",
  "manufacturer",
  "manufacturing",
  "industrial",
  "corporation",
  "holdings",
  "global",
  "international",
  "group plc",
  "plc"
];

const BLOCKED_LARGE_BRANDS = [
  "sally beauty",
  "cosmoprof",
  "saloncentric",
  "supercuts",
  "toni & guy",
  "toni and guy",
  "regis",
  "headmasters",
  "rush hair",
  "nuffield health",
  "puregym",
  "the gym group",
  "david lloyd",
  "anytime fitness",
  "mcdonald",
  "starbucks",
  "subway",
  "burger king",
  "kfc",
  "domino",
  "pizza hut",
  "greggs",
  "costa coffee",
  "tesco",
  "asda",
  "sainsbury",
  "morrisons",
  "halfords",
  "kwik fit"
];

const CATEGORY_KEYWORDS = {
  car: [
    "valet",
    "valeting",
    "detail",
    "detailing",
    "autocare",
    "auto care",
    "car care",
    "car wash",
    "carwash",
    "vehicle cleaning",
    "vehicle care",
    "body repair",
    "bodyshop",
    "body shop",
    "paint repair",
    "smart repair",
    "ceramic coating",
    "wrapping",
    "car wrap"
  ],

  beauty: [
    "barber",
    "hair",
    "hairdresser",
    "salon",
    "beauty",
    "nail",
    "aesthetic",
    "aesthetics",
    "lashes",
    "brows",
    "spa",
    "massage"
  ],

  cleaning: [
    "cleaner",
    "cleaning",
    "carpet clean",
    "window clean",
    "pressure wash",
    "jet wash",
    "domestic clean",
    "commercial clean"
  ],

  trades: [
    "plumber",
    "plumbing",
    "electrician",
    "electrical",
    "builder",
    "building",
    "roof",
    "roofer",
    "landscape",
    "landscaping",
    "gardener",
    "gardening",
    "decorator",
    "decorating",
    "painting",
    "handyman"
  ],

  food: [
    "cafe",
    "café",
    "coffee",
    "restaurant",
    "takeaway",
    "bakery",
    "bistro",
    "kitchen",
    "catering",
    "pizza",
    "burger",
    "grill",
    "food"
  ],

  fitness: [
    "gym",
    "fitness",
    "personal trainer",
    "personal training",
    "yoga",
    "pilates",
    "martial arts",
    "boxing",
    "crossfit"
  ]
};

export async function onRequestPost({ request, env }) {
  try {
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

    const session = await env.DB.prepare(`
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
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      return json(
        {
          success: false,
          error: "Session expired. Please log in again."
        },
        401
      );
    }

    if (
      String(session.email || "")
        .trim()
        .toLowerCase() !== ADMIN_EMAIL
    ) {
      return json(
        {
          success: false,
          error: "Admin access only."
        },
        403
      );
    }

    if (!env.HUNTER_API_KEY) {
      return json(
        {
          success: false,
          error: "Hunter API is not configured."
        },
        500
      );
    }

    let body = {};

    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const query = String(
      body.query ||
      "Independent local service businesses"
    )
      .trim()
      .slice(0, 1500);

    const category =
      detectCategory(query);

    const hunterUrl =
      `https://api.hunter.io/v2/discover?api_key=${
        encodeURIComponent(env.HUNTER_API_KEY)
      }`;

    const discoverBody = {
      query:
        buildHunterQuery(
          query,
          category
        ),

      headquarters_location: {
        include: [
          {
            country: "GB"
          }
        ]
      },

      headcount: [
        "1-10",
        "11-50"
      ],

      company_type: {
        exclude: [
          "educational",
          "non profit",
          "government agency"
        ]
      }
    };

    const hunterResponse =
      await fetch(
        hunterUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              discoverBody
            )
        }
      );

    const hunterData =
      await hunterResponse
        .json()
        .catch(() => ({}));

    if (!hunterResponse.ok) {
      console.error(
        "Hunter Discover error:",
        hunterData
      );

      return json(
        {
          success: false,

          error:
            hunterData?.errors?.[0]?.details ||
            hunterData?.errors?.[0]?.id ||
            hunterData?.message ||
            "Hunter could not find businesses."
        },
        hunterResponse.status
      );
    }

    const companies =
      Array.isArray(hunterData?.data)
        ? hunterData.data
        : [];

    const results = [];

    let blocked = 0;
    let wrongCountry = 0;
    let wrongType = 0;
    let noEmail = 0;
    let noGenericEmail = 0;
    let duplicate = 0;

    for (const company of companies) {
      const domain =
        cleanDomain(
          company?.domain
        );

      const businessName =
        String(
          company?.organization ||
          company?.name ||
          domain
        )
          .trim()
          .slice(0, 250);

      if (
        !domain ||
        !businessName
      ) {
        continue;
      }

      const searchableText =
        buildSearchableText(
          company,
          businessName,
          domain
        );

      if (
        !looksBritish(
          company,
          domain
        )
      ) {
        wrongCountry++;
        continue;
      }

      if (
        containsBlockedWord(
          searchableText
        )
      ) {
        blocked++;
        continue;
      }

      if (
        isBlockedLargeBrand(
          businessName,
          domain
        )
      ) {
        blocked++;
        continue;
      }

      if (
        isBlockedDomain(domain)
      ) {
        blocked++;
        continue;
      }

      if (
        category !== "mixed" &&
        !matchesCategory(
          searchableText,
          category
        )
      ) {
        wrongType++;
        continue;
      }

      const totalEmails =
        safeNumber(
          company?.emails_count?.total
        );

      const genericEmails =
        safeNumber(
          company?.emails_count?.generic
        );

      const personalEmails =
        safeNumber(
          company?.emails_count?.personal
        );

      if (totalEmails < 1) {
        noEmail++;
        continue;
      }

      if (genericEmails < 1) {
        noGenericEmail++;
        continue;
      }

      const existing =
        await env.DB.prepare(`
          SELECT id
          FROM prospects
          WHERE
            LOWER(business_name) = LOWER(?)
          OR
            LOWER(contact_details) LIKE LOWER(?)
          LIMIT 1
        `)
          .bind(
            businessName,
            `%${domain}%`
          )
          .first();

      if (existing) {
        duplicate++;
        continue;
      }

      results.push({
        businessName,
        domain,
        emailsAvailable:
          totalEmails,
        genericEmails,
        personalEmails
      });
    }

    results.sort(
      (a, b) => {
        const aUk =
          a.domain.endsWith(".uk")
            ? 1
            : 0;

        const bUk =
          b.domain.endsWith(".uk")
            ? 1
            : 0;

        if (aUk !== bUk) {
          return bUk - aUk;
        }

        return (
          b.genericEmails -
          a.genericEmails
        );
      }
    );

    return json({
      success: true,

      mode: "preview",

      country:
        "United Kingdom",

      companySize:
        "1-50 employees",

      category,

      query,

      found:
        companies.length,

      eligible:
        results.length,

      businesses:
        results,

      rejected: {
        blocked,
        wrongCountry,
        wrongType,
        noEmail,
        noGenericEmail,
        duplicate
      },

      message:
        "Search complete. Only small UK businesses suitable for LocalBoost outreach are shown. No outreach emails were sent."
    });

  } catch (error) {
    console.error(
      "UK business finder error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Could not search for UK businesses."
      },
      500
    );
  }
}


function buildHunterQuery(
  query,
  category
) {
  const categoryText = {
    car:
      "car valeting, vehicle detailing, car care and vehicle cleaning businesses",

    beauty:
      "independent hair salons, beauty salons, barbers, nail salons and aesthetics businesses",

    cleaning:
      "independent cleaning, carpet cleaning, window cleaning and pressure washing businesses",

    trades:
      "independent plumbers, electricians, builders, roofers, gardeners and local trades businesses",

    food:
      "independent cafes, restaurants, takeaways, bakeries and local food businesses",

    fitness:
      "independent gyms, personal trainers, fitness studios, yoga and pilates businesses",

    mixed:
      "independent local service businesses"
  };

  return (
    String(query || "") +
    ". Find " +
    categoryText[category] +
    " that are small independent local businesses based in the United Kingdom. Avoid large chains, national brands,
