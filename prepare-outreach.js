const ADMIN_EMAIL = "samtest1109@example.com";

const MAX_BUSINESSES = 10;

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
  "team"
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
      CONFIG CHECKS
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

    /*
      =============================
      READ REQUEST
      =============================
    */

    let body = {};

    try {
      body =
        await request.json();
    } catch {
      body = {};
    }

    const incomingBusinesses =
      Array.isArray(body.businesses)
        ? body.businesses
        : [];

    if (!incomingBusinesses.length) {
      return json(
        {
          success: false,
          error:
            "No businesses were provided."
        },
        400
      );
    }

    /*
      Only process the first 10.

      Hunter Domain Search consumes
      search credits, so this keeps the
      first test controlled.
    */

    const businesses =
      incomingBusinesses
        .slice(
          0,
          MAX_BUSINESSES
        );

    const prepared = [];

    const skipped = {
      invalidBusiness: 0,
      alreadyApproached: 0,
      noGenericEmail: 0,
      suppressed: 0,
      hunterError: 0
    };

    /*
      =============================
      PREPARE EACH BUSINESS
      =============================
    */

    for (
      const business of businesses
    ) {
      const businessName =
        cleanText(
          business?.businessName,
          250
        );

      const domain =
        cleanDomain(
          business?.domain
        );

      if (
        !businessName ||
        !domain
      ) {
        skipped.invalidBusiness++;

        continue;
      }

      /*
        Skip businesses LocalBoost has
        already approached.
      */

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
        skipped.alreadyApproached++;

        continue;
      }

      /*
        =============================
        HUNTER DOMAIN SEARCH
        =============================

        type=generic means Hunter should
        return public role-based business
        addresses such as info@ or hello@,
        rather than personal employee
        addresses.
      */

      const hunterUrl =
        new URL(
          "https://api.hunter.io/v2/domain-search"
        );

      hunterUrl.searchParams.set(
        "domain",
        domain
      );

      hunterUrl.searchParams.set(
        "type",
        "generic"
      );

      hunterUrl.searchParams.set(
        "api_key",
        env.HUNTER_API_KEY
      );

      let hunterResponse;
      let hunterData;

      try {
        hunterResponse =
          await fetch(
            hunterUrl.toString(),
            {
              method: "GET",
              headers: {
                "Accept":
                  "application/json"
              }
            }
          );

        hunterData =
          await hunterResponse
            .json()
            .catch(() => ({}));

      } catch (error) {
        console.error(
          "Hunter Domain Search request error:",
          domain,
          error
        );

        skipped.hunterError++;

        continue;
      }

      if (!hunterResponse.ok) {
        console.error(
          "Hunter Domain Search error:",
          domain,
          hunterData
        );

        skipped.hunterError++;

        continue;
      }

      const hunterEmails =
        Array.isArray(
          hunterData?.data?.emails
        )
          ? hunterData.data.emails
          : [];

      /*
        Hunter can return several generic
        addresses. Clean them and rank the
        most useful business addresses first.
      */

      const candidates =
        hunterEmails
          .map(email => ({
            email:
              normalizeEmail(
                email?.value
              ),

            type:
              String(
                email?.type || ""
              )
                .trim()
                .toLowerCase(),

            confidence:
              safeNumber(
                email?.confidence
              )
          }))
          .filter(candidate =>
            candidate.email &&
            candidate.type ===
              "generic"
          );

      if (!candidates.length) {
        skipped.noGenericEmail++;

        continue;
      }

      candidates.sort(
        compareCandidates
      );

      /*
        Check each candidate against our
        permanent do-not-contact list.

        If the best email is suppressed,
        try another generic address from
        the same business.
      */

      let selected = null;

      for (
        const candidate of candidates
      ) {
        const suppression =
          await env.DB.prepare(`
            SELECT
              reason,
              source
            FROM suppression_list
            WHERE LOWER(email) = LOWER(?)
            LIMIT 1
          `)
            .bind(
              candidate.email
            )
            .first();

        if (suppression) {
          skipped.suppressed++;

          continue;
        }

        selected = candidate;

        break;
      }

      if (!selected) {
        continue;
      }

      prepared.push({
        businessName,
        domain,

        email:
          selected.email,

        confidence:
          selected.confidence,

        emailType:
          "generic",

        status:
          "ready",

        willSend:
          false
      });
    }

    /*
      =============================
      PREVIEW RESPONSE
      =============================
    */

    return json({
      success: true,

      mode:
        "preview",

      requested:
        incomingBusinesses.length,

      checked:
        businesses.length,

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


/*
  =============================
  EMAIL RANKING
  =============================
*/

function compareCandidates(
  a,
  b
) {
  const aPrefix =
    getEmailPrefixRank(
      a.email
    );

  const bPrefix =
    getEmailPrefixRank(
      b.email
    );

  if (
    aPrefix !==
    bPrefix
  ) {
    return aPrefix - bPrefix;
  }

  return (
    b.confidence -
    a.confidence
  );
}


function getEmailPrefixRank(
  email
) {
  const prefix =
    String(email || "")
      .split("@")[0]
      .toLowerCase();

  const index =
    PREFERRED_PREFIXES.indexOf(
      prefix
    );

  return index === -1
    ? 999
    : index;
}


/*
  =============================
  HELPERS
  =============================
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


function cleanDomain(
  value
) {
  return String(
    value || ""
  )
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
    .slice(
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
