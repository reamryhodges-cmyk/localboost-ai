const ADMIN_EMAIL = "samtest1109@example.com";

const DEFAULT_DAILY_LIMIT = 30;
const DEFAULT_BATCH_SIZE = 10;

export async function onRequestPost({ request, env }) {
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

    const user = await getLoggedInUser(request, env);

    if (!user) {
      return json(
        {
          success: false,
          error: "Please log in."
        },
        401
      );
    }

    if (
      String(user.email || "").toLowerCase() !==
      ADMIN_EMAIL.toLowerCase()
    ) {
      return json(
        {
          success: false,
          error: "Admin access required."
        },
        403
      );
    }

    const settings = await env.DB.prepare(`
      SELECT
        id,
        enabled,
        daily_limit,
        batch_size,
        business_type,
        last_run_at
      FROM outreach_automation
      ORDER BY id ASC
      LIMIT 1
    `).first();

    if (!settings) {
      return json(
        {
          success: false,
          error: "Outreach automation settings were not found."
        },
        500
      );
    }

    if (Number(settings.enabled) !== 1) {
      return json({
        success: true,
        ran: false,
        reason: "automation_disabled",
        message:
          "AI outreach automation is currently switched off."
      });
    }

    const dailyLimit = clampInteger(
      settings.daily_limit,
      1,
      DEFAULT_DAILY_LIMIT,
      DEFAULT_DAILY_LIMIT
    );

    const batchSize = clampInteger(
      settings.batch_size,
      1,
      10,
      DEFAULT_BATCH_SIZE
    );

    const sentToday = await getSentToday(env);

    if (sentToday >= dailyLimit) {
      return json({
        success: true,
        ran: false,
        reason: "daily_limit_reached",
        sentToday,
        dailyLimit,
        remainingToday: 0,
        message:
          "The daily outreach limit has already been reached."
      });
    }

    const remainingToday = dailyLimit - sentToday;

    const allowedBatchSize = Math.min(
      batchSize,
      remainingToday,
      10
    );

    const businessType =
      cleanText(settings.business_type, 100) || "mixed";

    const origin = new URL(request.url).origin;

    /*
      IMPORTANT:
      This runner uses the same existing LocalBoost endpoints
      that were already tested manually.

      It does not bypass:
      - UK-domain checks
      - generic-email checks
      - confidence checks
      - suppression checks
      - duplicate checks
      - daily sending limits
    */

    const cookie =
      request.headers.get("Cookie") || "";

    const findResponse = await fetch(
      `${origin}/find-uk-businesses`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie
        },
        body: JSON.stringify({
          businessType
        })
      }
    );

    const findData = await safeJson(findResponse);

    if (
      !findResponse.ok ||
      !findData ||
      findData.success === false
    ) {
      return json(
        {
          success: false,
          stage: "find",
          error:
            findData?.error ||
            "AI could not find suitable UK businesses."
        },
        502
      );
    }

    const foundBusinesses = extractBusinesses(findData);

    if (!foundBusinesses.length) {
      await updateLastRun(env);

      return json({
        success: true,
        ran: true,
        stage: "find",
        found: 0,
        prepared: 0,
        sent: 0,
        message:
          "No suitable new UK businesses were found."
      });
    }

    const prepareResponse = await fetch(
      `${origin}/prepare-outreach`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie
        },
        body: JSON.stringify({
          businesses: foundBusinesses.slice(0, 10)
        })
      }
    );

    const prepareData = await safeJson(
      prepareResponse
    );

    if (
      !prepareResponse.ok ||
      !prepareData ||
      prepareData.success === false
    ) {
      return json(
        {
          success: false,
          stage: "prepare",
          error:
            prepareData?.error ||
            "AI could not prepare suitable outreach."
        },
        502
      );
    }

    const preparedBusinesses =
      extractBusinesses(prepareData)
        .filter(isPreparedBusiness)
        .slice(0, allowedBatchSize);

    if (!preparedBusinesses.length) {
      await updateLastRun(env);

      return json({
        success: true,
        ran: true,
        stage: "prepare",
        found: foundBusinesses.length,
        prepared: 0,
        sent: 0,
        message:
          "Businesses were found, but none passed the final email checks."
      });
    }

    const sendResponse = await fetch(
      `${origin}/outreach-send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie
        },
        body: JSON.stringify({
          businesses: preparedBusinesses
        })
      }
    );

    const sendData = await safeJson(sendResponse);

    if (
      !sendResponse.ok ||
      !sendData ||
      sendData.success === false
    ) {
      return json(
        {
          success: false,
          stage: "send",
          error:
            sendData?.error ||
            "The outreach send stage failed."
        },
        502
      );
    }

    await updateLastRun(env);

    const sent =
      Number(
        sendData.sent ??
        sendData.sentCount ??
        0
      ) || 0;

    const skipped =
      Number(
        sendData.skipped ??
        sendData.skippedCount ??
        0
      ) || 0;

    const failed =
      Number(
        sendData.failed ??
        sendData.failedCount ??
        0
      ) || 0;

    const newSentToday = sentToday + sent;

    return json({
      success: true,
      ran: true,
      stage: "complete",

      businessType,

      found: foundBusinesses.length,
      prepared: preparedBusinesses.length,

      sent,
      skipped,
      failed,

      sentToday: newSentToday,
      dailyLimit,

      remainingToday: Math.max(
        0,
        dailyLimit - newSentToday
      ),

      message:
        sent > 0
          ? `AI outreach completed. ${sent} email${sent === 1 ? "" : "s"} sent.`
          : "AI outreach completed, but no emails were sent."
    });
  } catch (error) {
    console.error(
      "Outreach automation runner error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "The AI outreach automation could not complete."
      },
      500
    );
  }
}

async function getLoggedInUser(request, env) {
  const token = getCookie(
    request.headers.get("Cookie") || "",
    "localboost_session"
  );

  if (!token) {
    return null;
  }

  const user = await env.DB.prepare(`
    SELECT
      u.id,
      u.email,
     
