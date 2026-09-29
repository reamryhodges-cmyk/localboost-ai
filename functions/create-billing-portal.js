const BILLING_RETURN_URL = "https://localboost4u.co.uk/dashboard.html";

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return "";
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return jsonResponse({ error: "Database is not configured." }, 500);
    }

    const token = getCookie(request, "localboost_session");
    if (!token) {
      return jsonResponse({ error: "Please log in to manage billing." }, 401);
    }

    const session = await env.DB.prepare(`
      SELECT
        sessions.user_id,
        sessions.expires_at,
        users.email,
        users.stripe_customer_id
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ?
      LIMIT 1
    `)
      .bind(token)
      .first();

    if (!session) {
      return jsonResponse({ error: "Your login session is not valid. Please log in again." }, 401);
    }

    const expiry = new Date(session.expires_at).getTime();
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      await env.DB.prepare("DELETE FROM sessions WHERE token = ?")
        .bind(token)
        .run();
      return jsonResponse({ error: "Your login session has expired. Please log in again." }, 401);
    }

    const customerId = String(session.stripe_customer_id || "").trim();
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) {
      return jsonResponse(
        { error: "No Stripe customer is linked to this account. Contact support@localboost4u.co.uk for help." },
        409
      );
    }

    const candidates = [
      env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY1,
      env.STRIPE_SANDBOX_SECRET_KEY
    ].filter((key) => key && key.startsWith("sk_"));

    if (!candidates.length) {
      return jsonResponse(
        { error: "Stripe billing management is unavailable. Contact support@localboost4u.co.uk for help." },
        503
      );
    }

    // Test and live Stripe IDs use the same format. Resolve the customer's
    // actual Stripe mode before creating a portal session.
    let stripeSecret = "";
    for (const candidate of candidates) {
      const customerResponse = await fetch(
        "https://api.stripe.com/v1/customers/" + encodeURIComponent(customerId),
        { headers: { Authorization: `Bearer ${candidate}` } }
      );

      if (customerResponse.ok) {
        stripeSecret = candidate;
        break;
      }

      if (customerResponse.status !== 404) {
        return jsonResponse(
          { error: "Stripe billing management is unavailable. Contact support@localboost4u.co.uk for help." },
          503
        );
      }
    }

    if (!stripeSecret) {
      return jsonResponse(
        { error: "No Stripe customer is linked to this account. Contact support@localboost4u.co.uk for help." },
        409
      );
    }

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          customer: customerId,
          return_url: BILLING_RETURN_URL
        }).toString()
      }
    );

    let stripeData = {};
    try {
      stripeData = await stripeResponse.json();
    } catch {}

    if (!stripeResponse.ok || !stripeData.url) {
      console.error("Stripe billing portal session could not be created.", {
        status: stripeResponse.status
      });
      return jsonResponse(
        { error: "Stripe billing management is unavailable right now. Contact support@localboost4u.co.uk to change or cancel your plan." },
        503
      );
    }

    let portalUrl;
    try {
      portalUrl = new URL(stripeData.url);
    } catch {
      return jsonResponse({ error: "Stripe returned an invalid billing link." }, 502);
    }

    if (
      portalUrl.protocol !== "https:" ||
      portalUrl.hostname !== "billing.stripe.com"
    ) {
      return jsonResponse({ error: "Stripe returned an invalid billing link." }, 502);
    }

    return jsonResponse({ success: true, url: portalUrl.href });
  } catch (error) {
    console.error("create-billing-portal-session failed.", {
      message: error && error.message ? error.message : "Unknown error"
    });
    return jsonResponse(
      { error: "Unable to open billing management. Contact support@localboost4u.co.uk for help." },
      500
    );
  }
}
