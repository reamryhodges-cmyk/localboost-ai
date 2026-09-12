
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
  "international"
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
      "Small independent local businesses based in the United Kingdom"
    )
      .trim()
      .slice(0, 1500);

    const category =
      detectCategory(query);

    const hunterUrl =
      `https://api.hunter.io/v2/discover?api_key=${
        encodeURIComponent(env.HUNTER_API_KEY)
      }`;

    const hunterResponse =
      await fetch(
        hunterUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            query
          })
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
        containsBlockedWord(
          searchableText
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

      /*
        We want a public business address
        wherever possible for outreach.
      */
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

    return json({
      success: true,

      mode: "preview",

      country:
        "United Kingdom",

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
        wrongType,
        noEmail,
        noGenericEmail,
        duplicate
      },

      message:
        "Search complete. Only suitable LocalBoost prospects are shown. No outreach emails were sent."
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


function detectCategory(query) {
  const text =
    normalize(query);

  if (
    text.includes("valet") ||
    text.includes("detailing") ||
    text.includes("vehicle cleaning") ||
    text.includes("car care")
  ) {
    return "car";
  }

  if (
    text.includes("barber") ||
    text.includes("hair salon") ||
    text.includes("beauty salon") ||
    text.includes("nail salon")
  ) {
    return "beauty";
  }

  if (
    text.includes("cleaner") ||
    text.includes("cleaning")
  ) {
    return "cleaning";
  }

  if (
    text.includes("plumber") ||
    text.includes("electrician") ||
    text.includes("builder") ||
    text.includes("landscap") ||
    text.includes("trades")
  ) {
    return "trades";
  }

  if (
    text.includes("restaurant") ||
    text.includes("takeaway") ||
    text.includes("cafe") ||
    text.includes("café") ||
    text.includes("food business")
  ) {
    return "food";
  }

  if (
    text.includes("gym") ||
    text.includes("fitness") ||
    text.includes("personal trainer")
  ) {
    return "fitness";
  }

  return "mixed";
}


function matchesCategory(
  text,
  category
) {
  const words =
    CATEGORY_KEYWORDS[category] || [];

  return words.some(
    word =>
      text.includes(
        normalize(word)
      )
  );
}


function containsBlockedWord(
  text
) {
  return BLOCKED_WORDS.some(
    word =>
      text.includes(
        normalize(word)
      )
  );
}


function isBlockedDomain(domain) {
  return (
    domain.endsWith(".gov.uk") ||
    domain.endsWith(".ac.uk") ||
    domain.includes(".nhs.uk") ||
    domain === "gov.uk"
  );
}


function buildSearchableText(
  company,
  businessName,
  domain
) {
  const fields = [
    businessName,
    domain,

    company?.industry,
    company?.sector,
    company?.category,
    company?.type,

    company?.description,
    company?.summary,

    company?.city,
    company?.location,
    company?.country,

    company?.keywords,
    company?.tags
  ];

  const values = [];

  for (const field of fields) {
    if (
      Array.isArray(field)
    ) {
      values.push(
        ...field
      );
    }

    else if (
      field &&
      typeof field === "object"
    ) {
      try {
        values.push(
          JSON.stringify(field)
        );
      } catch {
        // Ignore unreadable metadata
      }
    }

    else if (field) {
      values.push(field);
    }
  }

  return normalize(
    values.join(" ")
  );
}


function safeNumber(value) {
  const number =
    Number(value || 0);

  return Number.isFinite(number)
    ? number
    : 0;
}


function cleanDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(
      /^https?:\/\//,
      ""
    )
    .replace(
      /^www\./,
      ""
    )
    .replace(
      /\/.*$/,
      ""
    )
    .slice(0, 255);
}


function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(
      /[^a-z0-9.\-& ]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function getCookie(
  header,
  name
) {
  const item =
    header
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
