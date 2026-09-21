const ADMIN_EMAIL =
  "reamryhodges@gmail.com";

const MAX_BUSINESSES = 10;
const HUNTER_EMAIL_LIMIT = 10;
const MIN_CONFIDENCE = 70;

const PREFERRED_PREFIXES = [
  "hello",
  "info",
  "contact",
  "enquiries",
  "enquiry",
  "sales",
  "office",
  "bookings",
  "booking",
  "team",
  "admin"
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

const BLOCKED_BRANDS = [
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


export async function onRequestPost({
  request,
  env
}) {
  try {
    const auth =
      await requireAdmin(
        request,
        env
      );

    if (!auth.ok) {
      return auth.response;
    }

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
    }

    const incomingBusinesses =
      Array.isArray(
        body.businesses
      )
        ? body.businesses
        : [];

    if (
      !incomingBusinesses.length
    ) {
      return json(
        {
          success: false,
          error:
            "No businesses were provided."
        },
        400
      );
    }

    const businesses =
      incomingBusinesses.slice(
        0,
        MAX_BUSINESSES
      );

    const prepared = [];

    const seenDomains =
      new Set();

    const skipped = {
      invalidBusiness: 0,
      notVerifiedUk: 0,
      duplicateInput: 0,
      blockedBusiness: 0,
      alreadyApproached: 0,
      hunterError: 0,
      noGenericEmail: 0,
      lowConfidence: 0,
      wrongEmailDomain: 0,
      suppressed: 0
    };

    let hunterLookups = 0;

    for (
      const business
      of businesses
    ) {
      const businessName =
        cleanText(
          business
            ?.businessName,
          250
        );

      const domain =
        cleanDomain(
          business
            ?.domain
        );

      if (
        !businessName ||
        !domain
      ) {
        skipped
          .invalidBusiness++;

        continue;
      }

      if (
        !isStrictUkDomain(
          domain
        )
      ) {
        skipped
          .notVerifiedUk++;

        continue;
      }

      if (
        seenDomains.has(
          domain
        )
      ) {
        skipped
          .duplicateInput++;

        continue;
      }

      seenDomains.add(
        domain
      );

      if (
        isBlockedDomain(
          domain
        ) ||
        isBlockedBusiness(
          businessName,
          domain
        )
      ) {
        skipped
          .blockedBusiness++;

        continue;
      }

      if (
        business
          ?.ukVerified ===
        false
      ) {
        skipped
          .notVerifiedUk++;

        continue;
      }

      const existing =
        await findExistingProspect(
          env,
          businessName,
          domain
        );

      if (existing) {
        skipped
          .alreadyApproached++;

        continue;
      }

      const hunterUrl =
        new URL(
          "https://api.hunter.io/v2/domain-search"
        );

      hunterUrl
        .searchParams
        .set(
          "domain",
          domain
        );

      hunterUrl
        .searchParams
        .set(
          "type",
          "generic"
        );

      hunterUrl
        .searchParams
        .set(
          "limit",
          String(
            HUNTER_EMAIL_LIMIT
          )
        );

      hunterUrl
        .searchParams
        .set(
          "api_key",
          env.HUNTER_API_KEY
        );

      let hunterResponse;
      let hunterData;

      try {
        hunterLookups++;

        hunterResponse =
          await fetch(
            hunterUrl.toString(),
            {
              method: "GET",
              headers: {
                Accept:
                  "application/json"
              }
            }
          );

        hunterData =
          await hunterResponse
            .json()
            .catch(
              () => ({})
            );

      } catch (error) {
        console.error(
          "Hunter request failed:",
          domain,
          error
        );

        skipped
          .hunterError++;

        continue;
      }

      if (
        !hunterResponse.ok
      ) {
        console.error(
          "Hunter error:",
          domain,
          hunterData
        );

        skipped
          .hunterError++;

        continue;
      }

      const hunterEmails =
        Array.isArray(
          hunterData
            ?.data
            ?.emails
        )
          ? hunterData
              .data
              .emails
          : [];

      const generic =
        hunterEmails
          .map(
            item => ({
              email:
                normalizeEmail(
                  item?.value
                ),

              type:
                String(
                  item?.type ||
                  ""
                )
                  .trim()
                  .toLowerCase(),

              confidence:
                safeNumber(
                  item
                    ?.confidence
                )
            })
          )
          .filter(
            item =>
              item.email &&
              item.type ===
                "generic"
          );

      if (
        !generic.length
      ) {
        skipped
          .noGenericEmail++;

        continue;
      }

      const matching =
        generic.filter(
          item =>
            emailMatchesDomain(
              item.email,
              domain
            )
        );

      if (
        !matching.length
      ) {
        skipped
          .wrongEmailDomain++;

        continue;
      }

      const confident =
        matching.filter(
          item =>
            item.confidence !==
              null &&
            item.confidence >=
              MIN_CONFIDENCE
        );

      if (
        !confident.length
      ) {
        skipped
          .lowConfidence++;

        continue;
      }

      confident.sort(
        compareCandidates
      );

      let selected =
        null;

      for (
        const candidate
        of confident
      ) {
        const suppressed =
          await findSuppression(
            env,
            candidate.email
          );

        if (suppressed) {
          skipped
            .suppressed++;

          continue;
        }

        const existingEmail =
          await findExistingEmail(
            env,
            candidate.email
          );

        if (
          existingEmail
        ) {
          skipped
            .alreadyApproached++;

          continue;
        }

        selected =
          candidate;

        break;
      }

      if (!selected) {
        continue;
      }

      prepared.push({
        businessName,

        businessType:
          cleanText(
            business
              ?.businessType,
            150
          ) ||
          "Local Service Business",

        location:
          cleanText(
            business
              ?.location,
            150
          ) ||
          "United Kingdom",

        domain,

        email:
          selected.email,

        confidence:
          selected.confidence,

        emailType:
          "generic",

        ukVerified:
          true,

        qualityScore:
          safeNumber(
            business
              ?.qualityScore
          ),

        status:
          "ready",

        willSend:
          false
      });
    }

    return json({
      success: true,

      mode:
        "preview",

      requested:
        incomingBusinesses
          .length,

      checked:
        businesses.length,

      hunterLookups,

      minimumConfidence:
        MIN_CONFIDENCE,

      ready:
        prepared.length,

      businesses:
        prepared,

      skipped,

      message:
        "Outreach preview prepared. No emails were sent."
    });

  } catch (error) {
    console.error(
      "Prepare outreach error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Could not prepare outreach."
      },
      500
    );
  }
}


async function requireAdmin(
  request,
  env
) {
  if (!env.DB) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Database is not configured."
          },
          500
        )
    };
  }

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
        ON u.id =
        s.user_id
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
    ).getTime() <=
      Date.now()
  ) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Session expired."
          },
          401
        )
    };
  }

  if (
    String(
      session.email ||
      ""
    )
      .trim()
      .toLowerCase() !==
    ADMIN_EMAIL.toLowerCase()
  ) {
    return {
      ok: false,

      response:
        json(
          {
            success: false,
            error:
              "Admin access required."
          },
          403
        )
    };
  }

  return {
    ok: true
  };
}


async function findExistingProspect(
  env,
  businessName,
  domain
) {
  try {
    const result =
      await env.DB.prepare(`
        SELECT id
        FROM prospects
        WHERE
          LOWER(business_name)
          =
          LOWER(?)
        OR
          LOWER(contact_details)
          LIKE ?
        LIMIT 1
      `)
        .bind(
          businessName,
          `%${domain}%`
        )
        .first();

    return !!result;

  } catch (error) {
    console.warn(
      "Prospect check failed:",
      error
    );

    return false;
  }
}


async function findExistingEmail(
  env,
  email
) {
  try {
    const result =
      await env.DB.prepare(`
        SELECT id
        FROM prospects
        WHERE
          LOWER(contact_details)
          =
          LOWER(?)
        LIMIT 1
      `)
        .bind(email)
        .first();

    return !!result;

  } catch (error) {
    console.warn(
      "Existing email check failed:",
      error
    );

    return false;
  }
}


async function findSuppression(
  env,
  email
) {
  try {
    const result =
      await env.DB.prepare(`
        SELECT email
        FROM suppression_list
        WHERE
          LOWER(email)
          =
          LOWER(?)
        LIMIT 1
      `)
        .bind(email)
        .first();

    return !!result;

  } catch (error) {
    console.warn(
      "Suppression check failed:",
      error
    );

    return true;
  }
}


function compareCandidates(
  a,
  b
) {
  const aPrefix =
    emailPrefixRank(
      a.email
    );

  const bPrefix =
    emailPrefixRank(
      b.email
    );

  if (
    aPrefix !==
    bPrefix
  ) {
    return (
      aPrefix -
      bPrefix
    );
  }

  return (
    Number(
      b.confidence ||
      0
    ) -
    Number(
      a.confidence ||
      0
    )
  );
}


function emailPrefixRank(
  email
) {
  const prefix =
    String(
      email || ""
    )
      .split("@")[0]
      .toLowerCase();

  const index =
    PREFERRED_PREFIXES
      .indexOf(
        prefix
      );

  return index === -1
    ? 999
    : index;
}


function emailMatchesDomain(
  email,
  domain
) {
  const emailDomain =
    String(
      email || ""
    )
      .split("@")[1] ||
    "";

  return (
    emailDomain ===
      domain ||
    emailDomain.endsWith(
      "." + domain
    ) ||
    domain.endsWith(
      "." +
      emailDomain
    )
  );
}


function isStrictUkDomain(
  domain
) {
  return (
    domain.endsWith(
      ".co.uk"
    ) ||
    domain.endsWith(
      ".org.uk"
    ) ||
    domain.endsWith(
      ".me.uk"
    ) ||
    domain.endsWith(
      ".ltd.uk"
    ) ||
    domain.endsWith(
      ".plc.uk"
    ) ||
    domain.endsWith(
      ".net.uk"
    ) ||
    domain.endsWith(
      ".uk"
    )
  );
}


function isBlockedDomain(
  domain
) {
  return BLOCKED_DOMAINS
    .some(
      blocked =>
        domain ===
          blocked ||
        domain.endsWith(
          "." +
          blocked
        )
    );
}


function isBlockedBusiness(
  businessName,
  domain
) {
  const text =
    `${businessName} ${domain}`
      .toLowerCase();

  return BLOCKED_BRANDS
    .some(
      brand =>
        text.includes(
          brand
        )
    );
}


function cleanDomain(
  value
) {
  let domain =
    String(
      value || ""
    )
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
      .split("#")[0];

  if (
    !domain ||
    !domain.includes(".")
  ) {
    return "";
  }

  return domain;
}


function normalizeEmail(
  value
) {
  const email =
    String(
      value || ""
    )
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


function safeNumber(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function cleanText(
  value,
  maxLength
) {
  return String(
    value || ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );
}


function getCookie(
  header,
  name
) {
  const item =
    String(
      header || ""
    )
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
    ? decodeURIComponent(
        item.slice(
          name.length + 1
        )
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
