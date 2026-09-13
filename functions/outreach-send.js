
const ADMIN_EMAIL =
  "samtest1109@example.com";

const FROM_EMAIL =
  "LocalBoost AI <hello@localboost4u.co.uk>";

const REPLY_TO_EMAIL =
  "support@localboost4u.co.uk";

const DAILY_LIMIT = 30;
const MAX_BATCH_SIZE = 10;
const MIN_CONFIDENCE = 70;

const AI_MODEL =
  "@cf/meta/llama-3.1-8b-instruct-fast";

const SITE_URL =
  "https://localboost4u.co.uk";

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

    if (!env.RESEND_API_KEY) {
      return json(
        {
          success: false,
          error:
            "Email service is not configured."
        },
        500
      );
    }

    if (!env.UNSUBSCRIBE_SECRET) {
      return json(
        {
          success: false,
          error:
            "Unsubscribe service is not configured."
        },
        500
      );
    }

    let body = {};

    try {
      body =
        await request.json();
    } catch {
      return json(
        {
          success: false,
          error:
            "Invalid request."
        },
        400
      );
    }

    let businesses = [];

    if (
      Array.isArray(
        body.businesses
      )
    ) {
      businesses =
        body.businesses.slice(
          0,
          MAX_BATCH_SIZE
        );
    } else {
      businesses = [
        {
          businessName:
            body.businessName,

          businessType:
            body.businessType,

          location:
            body.location,

          domain:
            body.domain,

          email:
            body.email,

          confidence:
            body.confidence,

          ukVerified:
            body.ukVerified,

          qualityScore:
            body.qualityScore
        }
      ];
    }

    if (!businesses.length) {
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
      Count outreach sent today.

      We use the current UTC calendar day
      rather than a rolling 24-hour window.
    */

    const dailyCount =
      await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM prospects
        WHERE
          LOWER(contact_method) = 'email'
        AND
          DATE(approached_at) =
          DATE('now')
      `)
        .first();

    let sentToday =
      Number(
        dailyCount?.total || 0
      );

    if (
      sentToday >=
      DAILY_LIMIT
    ) {
      return json(
        {
          success: false,

          error:
            "Daily outreach limit reached.",

          sentToday,

          dailyLimit:
            DAILY_LIMIT,

          remainingToday: 0
        },
        429
      );
    }

    const sent = [];
    const skipped = [];
    const failed = [];
    const seenEmails =
      new Set();
    const seenDomains =
      new Set();

    for (
      const rawBusiness
      of businesses
    ) {
      if (
        sentToday >=
        DAILY_LIMIT
      ) {
        skipped.push({
          businessName:
            clean(
              rawBusiness
                ?.businessName,
              200
            ),

          reason:
            "Daily outreach limit reached."
        });

        continue;
      }

      const businessName =
        clean(
          rawBusiness
            ?.businessName,
          200
        );

      const businessType =
        clean(
          rawBusiness
            ?.businessType,
          200
        );

      const location =
        clean(
          rawBusiness
            ?.location,
          200
        );

      const domain =
        cleanDomain(
          rawBusiness
            ?.domain
        );

      const email =
        normalizeEmail(
          rawBusiness
            ?.email
        );

      const confidence =
        safeNumber(
          rawBusiness
            ?.confidence
        );

      const ukVerified =
        rawBusiness
          ?.ukVerified ===
        true;

      if (!businessName) {
        skipped.push({
          businessName:
            "Unknown business",

          reason:
            "Missing business name."
        });

        continue;
      }

      if (!domain) {
        skipped.push({
          businessName,

          reason:
            "Missing or invalid domain."
        });

        continue;
      }

      /*
        Final country validation.

        The finder and prepare routes
