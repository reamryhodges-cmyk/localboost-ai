const ADMIN_EMAIL = "samtest1109@example.com";

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
      Maximum 10 businesses per prepare run.

      Important:
      We perform every free/local validation
      possible BEFORE calling Hunter Domain
      Search so search credits are not wasted
      on unsuitable businesses.
    */

    const businesses =
      incomingBusinesses.slice(
        0,
        MAX_BUSINESSES
      );

    const prepared = [];
    const seenDomains = new Set();

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
        UK REVALIDATION

        Never trust the browser/request alone.
        The prepare stage independently
        confirms the company uses a UK domain
        before a Hunter credit is spent.
      */

      if (
        !isStrictUkDomain(domain)
      ) {
        skipped.notVerifiedUk++;
        continue;
      }

      if (
        seenDomains.has(domain)
      ) {
        skipped.duplicateInput++;
        continue;
      }

      seenDomains.add(domain);

      if (
        isBlockedDomain(domain) ||
        isBlockedBusiness(
          businessName,
          domain
        )
      ) {
        skipped.blockedBusiness++;
        continue;
      }

      /*
        Finder currently marks approved
        results ukVerified=true.

        If the field exists and is explicitly
        false, reject the business.

        Older admin data without the field
        can still continue because the domain
        itself has already passed our strict
        UK validation above.
      */

      if (
        business?.ukVerified ===
        false
      ) {
        skipped.notVerifiedUk++;
        continue;
      }

      /*
        Check whether LocalBoost has already
        approached this company BEFORE doing
        the paid Hunter Domain Search.
      */

      const existing =
        await findExistingProspect(
          env,
          businessName,
          domain
        );

      if (existing) {
        skipped.alreadyApproached++;
        continue;
      }

      /*
        HUNTER DOMAIN SEARCH

        This is the stage that can consume
        Hunter search credits, so nothing
        reaches here unless it has already
        passed our filters.
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
        "limit",
        String(
          HUNTER_EMAIL_LIMIT
        )
      );

      hunterUrl.searchParams.set(
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
                "Accept":
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
        Only accept genuine role-based
        business addresses.

        Every candidate must:
        - be generic
        - be valid
        - belong to the company's domain
        - meet the confidence threshold
      */

      const rawGenericCandidates =
        hunterEmails
          .map(
            email => ({
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
            })
          )
          .filter(
            candidate =>
              candidate.email &&
              candidate.type ===
                "generic"
          );

      if (
        !rawGenericCandidates.length
      ) {
        skipped.noGenericEmail++;
        continue;
      }

      const domainMatched =
        rawGenericCandidates.filter(
          candidate =>
            emailMatchesDomain(
              candidate.email,
              domain
            )
        );

      if (!domainMatched.length) {
        skipped.wrongEmailDomain++;
        continue;
      }

      const candidates =
        domainMatched.filter(
          candidate =>
            candidate.confidence >=
            MIN_CONFIDENCE
        );

      if (!candidates.length) {
        skipped.lowConfidence++;
        continue;
      }

      candidates.sort(
        compareCandidates
      );

      /*
        Try candidates in priority order.

        Suppressed addresses are never made
        ready for sending.
      */

      let selected = null;

      for (
        const candidate
        of candidates
      ) {
        const suppression =
          await findSuppression(
            env,
            candidate.email
          );

        if (suppression) {
          skipped.suppressed++;
          continue;
        }

        /*
          Also ensure this exact email has
          not already appeared in prospects.
        */

        const existingEmail =
          await findExistingEmail(
            env,
            candidate.email
          );

        if (existingEmail) {
          skipped.alreadyApproached++;
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

        businessType:
          cleanText(
            business?.businessType,
            150
          ) ||
          "Local Service Business",

        location:
          cleanText(
            business?.location,
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

        ukVerified: true,

        qualityScore:
          safeNumber(
            business?.qualityScore
          ),

        status:
          "ready",

        willSend:
          false
      });
    }

    /*
      PREVIEW ONLY

      Preparing an address never sends
      anything. Sending remains a separate
      explicit admin action.
    */

    return json({
      success: true,

      mode:
        "preview",

      requested:
        incomingBusinesses.length,

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
    return
