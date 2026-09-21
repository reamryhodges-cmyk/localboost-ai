const ADMIN_EMAIL = "reamryhodges@gmail.com";

const MAX_RESULTS = 30;

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
  "public limited",
  "plc",
  "franchise",
  "franchising",
  "supplier",
  "wholesale",
  "wholesaler",
  "marketplace",
  "directory",
  "comparison site"
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
  "kwik fit",
  "imo car wash",
  "mister car wash",
  "quick quack",
  "club car wash",
  "go car wash",
  "delta sonic",
  "cobblestone",
  "autobell",
  "waterway",
  "rocket carwash",
  "rocket car wash",
  "luv car wash",
  "crew carwash",
  "crew car wash",
  "national carwash solutions",
  "national car wash solutions",
  "sonny's",
  "sonnys"
];

const BLOCKED_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "yell.com",
  "yelp.com",
  "checkatrade.com",
  "trustatrader.com",
  "ratedpeople.com",
  "mybuilder.com",
  "bark.com",
  "etsy.com",
  "amazon.co.uk",
  "amazon.com",
  "ebay.co.uk",
  "ebay.com",
  "booking.com",
  "tripadvisor.co.uk",
  "tripadvisor.com"
];

const FOREIGN_TLDS = [
  ".com.au",
  ".net.au",
  ".org.au",
  ".au",
  ".nl",
  ".de",
  ".fr",
  ".ie",
  ".es",
  ".it",
  ".be",
  ".ch",
  ".at",
  ".se",
  ".no",
  ".dk",
  ".fi",
  ".pl",
  ".cz",
  ".pt",
  ".nz",
  ".ca",
  ".us",
  ".za",
  ".in",
  ".sg"
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
    const auth = await requireAdmin(request, env);

    if (!auth.ok) {
      return auth.response;
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

    const query = cleanText(
      body.query || "Independent local service businesses",
      1500
    );

    const category = detectCategory(query);

    const hunterUrl =
      "https://api.hunter.io/v2/discover?api_key=" +
      encodeURIComponent(env.HUNTER_API_KEY);

    const discoverBody = {
      query: buildHunterQuery(query, category),

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
          "government agency",
          "public company"
        ]
      }
    };

    const hunterResponse = await fetch(hunterUrl, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },

      body: JSON.stringify(discoverBody)
    });

    const hunterData = await hunterResponse
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
    const seenDomains = new Set();

    const rejected = {
      invalid: 0,
      wrongCountry: 0,
      blocked: 0,
      wrongType: 0,
      noEmail: 0,
      noGenericEmail: 0,
      duplicate: 0
    };

    for (const company of companies) {
      if (results.length >= MAX_RESULTS) {
        break;
      }

      const domain =
        cleanDomain(company?.domain);

      const businessName =
        cleanText(
          company?.organization ||
          company?.name ||
          domain,
          250
        );

      if (!domain || !businessName) {
        rejected.invalid++;
        continue;
      }

      if (seenDomains.has(domain)) {
        rejected.duplicate++;
        continue;
      }

      seenDomains.add(domain);

      if (!isStrictUkDomain(domain)) {
        rejected.wrongCountry++;
        continue;
      }

      if (isForeignDomain(domain)) {
        rejected.wrongCountry++;
        continue;
      }

      if (isBlockedDomain(domain)) {
        rejected.blocked++;
        continue;
      }

      const searchableText =
        buildSearchableText(
          company,
          businessName,
          domain
        );

      if (
        containsBlockedWord(
          searchableText
        )
      ) {
        rejected.blocked++;
        continue;
      }

      if (
        isBlockedLargeBrand(
          businessName,
          domain
        )
      ) {
        rejected.blocked++;
        continue;
      }

      if (
        category !== "mixed" &&
        !matchesCategory(
          searchableText,
          category
        )
      ) {
        rejected.wrongType++;
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
        rejected.noEmail++;
        continue;
      }

      if (genericEmails < 1) {
        rejected.noGenericEmail++;
        continue;
      }

      const existing =
        await findExistingProspect(
          env,
          businessName,
          domain
        );

      if (existing) {
        rejected.duplicate++;
        continue;
      }

      results.push({
        businessName,

        businessType:
          categoryLabel(category),

        location:
          "United Kingdom",

        domain,

        ukVerified: true,

        companySize:
          "1-50 employees",

        emailsAvailable:
          totalEmails,

        genericEmails,

        personalEmails,

        qualityScore:
          calculateQualityScore({
            domain,
            genericEmails,
            personalEmails
          })
      });
    }

    results.sort(
      (a, b) => {
        if (
          b.qualityScore !==
          a.qualityScore
        ) {
          return (
            b.qualityScore -
            a.qualityScore
          );
        }

        if (
          b.genericEmails !==
          a.genericEmails
        ) {
          return (
            b.genericEmails -
            a.genericEmails
          );
        }

        return (
          a.businessName.localeCompare(
            b.businessName
          )
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

      strictUkOnly: true,

      category,

      query,

      found:
        companies.length,

      eligible:
        results.length,

      businesses:
        results,

      rejected,

      message:
        "Search complete. Only quality-first small UK businesses are shown. No outreach emails were sent."
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


async function requireAdmin(
  request,
  env
) {
  const token =
    getCookie(
      request.headers.get(
        "Cookie"
      ) || "",
      "localboost_session"
    );

  if (!token) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Please log in."
          },
          401
        )
    };
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
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Invalid session."
          },
          401
        )
    };
  }

  if (
    session.expires_at &&
    new Date(
      session.expires_at
    ).getTime() <= Date.now()
  ) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,

            error:
              "Session expired. Please log in again."
          },
          401
        )
    };
  }

  if (
    String(
      session.email || ""
    )
      .trim()
      .toLowerCase() !==
    ADMIN_EMAIL
  ) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Admin access only."
          },
          403
        )
    };
  }

  return {
    ok: true,
    session
  };
}


async function findExistingProspect(
  env,
  businessName,
  domain
) {
  try {
    return await env.DB.prepare(`
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

  } catch (error) {
    console.warn(
      "Prospect duplicate check skipped:",
      error
    );

    return null;
  }
}


function buildHunterQuery(
  query,
  category
) {
  const categoryText = {
    car:
      "independent car valeting, vehicle detailing, car care and vehicle cleaning businesses",

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

  return [
    String(query || ""),
    "Find",
    categoryText[category],
    "based in the United Kingdom.",
    "Only small local businesses with 1 to 50 employees.",
    "Exclude national chains, multinational companies, franchises, directories, marketplaces, suppliers, manufacturers and large corporate groups."
  ].join(" ");
}


function detectCategory(
  query
) {
  const text =
    String(query || "")
      .toLowerCase();

  for (
    const [category, words]
    of Object.entries(
      CATEGORY_KEYWORDS
    )
  ) {
    if (
      words.some(
        word =>
          text.includes(word)
      )
    ) {
      return category;
    }
  }

  return "mixed";
}


function categoryLabel(
  category
) {
  const labels = {
    car:
      "Car & Vehicle Services",

    beauty:
      "Hair & Beauty",

    cleaning:
      "Cleaning Services",

    trades:
      "Trades",

    food:
      "Food & Hospitality",

    fitness:
      "Fitness",

    mixed:
      "Local Service Business"
  };

  return (
    labels[category] ||
    labels.mixed
  );
}


function matchesCategory(
  text,
  category
) {
  const words =
    CATEGORY_KEYWORDS[category];

  if (!Array.isArray(words)) {
    return true;
  }

  return words.some(
    word =>
      text.includes(word)
  );
}


function buildSearchableText(
  company,
  businessName,
  domain
) {
  const values = [
    businessName,
    domain,
    company?.industry,
    company?.description,
    company?.category,
    company?.type,
    company?.company_type,
    company?.keywords,
    company?.tags,
    company?.headquarters_location,
    company?.location,
    company?.country,
    company?.city
  ];

  return values
    .flatMap(
      value => {
        if (
          Array.isArray(value)
        ) {
          return value;
        }

        if (
          value &&
          typeof value ===
            "object"
        ) {
          return Object.values(
            value
          );
        }

        return [value];
      }
    )
    .filter(Boolean)
    .map(
      value =>
        String(value)
          .toLowerCase()
    )
    .join(" ");
}


function containsBlockedWord(
  text
) {
  const value =
    String(text || "")
      .toLowerCase();

  return BLOCKED_WORDS.some(
    word =>
      value.includes(word)
  );
}


function isBlockedLargeBrand(
  businessName,
  domain
) {
  const value =
    (
      String(
        businessName || ""
      ) +
      " " +
      String(domain || "")
    )
      .toLowerCase();

  return BLOCKED_LARGE_BRANDS.some(
    brand =>
      value.includes(brand)
  );
}


function isBlockedDomain(
  domain
) {
  const value =
    cleanDomain(domain);

  return BLOCKED_DOMAINS.some(
    blocked =>
      value === blocked ||
      value.endsWith(
        "." + blocked
      )
  );
}


function isForeignDomain(
  domain
) {
  const value =
    cleanDomain(domain);

  return FOREIGN_TLDS.some(
    suffix =>
      value.endsWith(suffix)
  );
}


function isStrictUkDomain(
  domain
) {
  const value =
    cleanDomain(domain);

  return (
    value.endsWith(".co.uk") ||
    value.endsWith(".org.uk") ||
    value.endsWith(".me.uk") ||
    value.endsWith(".ltd.uk") ||
    value.endsWith(".plc.uk") ||
    value.endsWith(".net.uk") ||
    value.endsWith(".uk")
  );
}


function calculateQualityScore({
  domain,
  genericEmails,
  personalEmails
}) {
  let score = 0;

  if (
    domain.endsWith(".co.uk")
  ) {
    score += 50;

  } else if (
    domain.endsWith(".uk")
  ) {
    score += 40;
  }

  if (
    genericEmails >= 1
  ) {
    score += 30;
  }

  if (
    genericEmails >= 2
  ) {
    score += 10;
  }

  if (
    personalEmails <= 10
  ) {
    score += 10;
  }

  return Math.min(
    score,
    100
  );
}


function cleanDomain(
  value
) {
  let domain =
    String(value || "")
      .trim()
      .toLowerCase();

  domain =
    domain
      .replace(
        /^https?:\/\//,
        ""
      )
      .replace(
        /^www\./,
        ""
      )
      .split("/")[0]
      .split("?")[0]
      .split("#")[0]
      .replace(
        /:\d+$/,
        ""
      );

  if (
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i
      .test(domain)
  ) {
    return "";
  }

  return domain.slice(
    0,
    255
  );
}


function cleanText(
  value,
  maxLength
) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      " "
    )
    .slice(
      0,
      maxLength
    );
}


function safeNumber(
  value
) {
  const number =
    Number(value || 0);

  return Number.isFinite(
    number
  )
    ? number
    : 0;
}


function getCookie(
  header,
  name
) {
  const item =
    String(header || "")
      .split(";")
      .map(
        value =>
          value.trim()
      )
      .find(
        value =>
          value.startsWith(
            name + "="
          )
      );

  return item
    ? item.slice(
        name.length + 1
      )
    : "";
}


function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}
