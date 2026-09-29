import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as createCheckout } from "../functions/create-checkout-session.js";
import { onRequestPost as createBillingPortal } from "../functions/create-billing-portal-session.js";
import { onRequestGet as getSession } from "../functions/me.js";

const future = new Date(Date.now() + 60_000).toISOString();

function makeDb(session) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() { return session; },
            async run() { return { success: true }; }
          };
        }
      };
    }
  };
}

function request(path, body = {}, cookie = "localboost_session=valid") {
  return new Request("https://localboost4u.co.uk" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

test("checkout refuses a second recurring subscription before contacting Stripe", async () => {
  const oldFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("unexpected Stripe call"); };

  try {
    const response = await createCheckout({
      request: request("/create-checkout-session", { plan: "pro" }),
      env: {
        DB: makeDb({
          user_id: 42,
          expires_at: future,
          email: "customer@example.co.uk",
          stripe_subscription_id: "sub_existing",
          subscription_status: "active"
        })
      }
    });

    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /already has a subscription/i);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("checkout creates a Stripe session for a customer without an existing subscription", async () => {
  const oldFetch = globalThis.fetch;
  let stripeRequest;
  globalThis.fetch = async (url, options) => {
    stripeRequest = { url, options };
    return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay_test" }), { status: 200 });
  };

  try {
    const response = await createCheckout({
      request: request("/create-checkout-session", { plan: "business" }),
      env: {
        DB: makeDb({
          user_id: 43,
          expires_at: future,
          email: "newcustomer@example.co.uk",
          stripe_subscription_id: null,
          subscription_status: null
        }),
        STRIPE_SECRET_KEY: "sk_live_test"
      }
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.plan, "business");
    assert.equal(stripeRequest.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(new URLSearchParams(stripeRequest.options.body).get("mode"), "subscription");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("billing portal resolves the customer's Stripe mode and only returns a Stripe portal URL", async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/customers/cus_customer123")) {
      return calls.length === 1
        ? new Response(JSON.stringify({ error: { message: "No such customer" } }), { status: 404 })
        : new Response(JSON.stringify({ id: "cus_customer123" }), { status: 200 });
    }
    return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session_test_123" }), { status: 200 });
  };

  try {
    const response = await createBillingPortal({
      request: request("/create-billing-portal-session", {}),
      env: {
        DB: makeDb({
          user_id: 44,
          expires_at: future,
          email: "customer@example.co.uk",
          stripe_customer_id: "cus_customer123"
        }),
        STRIPE_SECRET_KEY: "sk_live_test",
        STRIPE_SANDBOX_SECRET_KEY: "sk_test_test"
      }
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).url, "https://billing.stripe.com/p/session_test_123");
    assert.equal(calls.length, 3);
    assert.equal(calls[1].options.headers.Authorization, "Bearer sk_test_test");
    assert.equal(calls[2].options.headers.Authorization, "Bearer sk_test_test");
    assert.equal(calls[2].url, "https://api.stripe.com/v1/billing_portal/sessions");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("billing portal rejects a URL outside Stripe's billing host", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/customers/cus_customer123")) {
      return new Response(JSON.stringify({ id: "cus_customer123" }), { status: 200 });
    }
    return new Response(JSON.stringify({ url: "https://attacker.example/fake-billing" }), { status: 200 });
  };

  try {
    const response = await createBillingPortal({
      request: request("/create-billing-portal-session", {}),
      env: {
        DB: makeDb({
          user_id: 45,
          expires_at: future,
          email: "customer@example.co.uk",
          stripe_customer_id: "cus_customer123"
        }),
        STRIPE_SECRET_KEY: "sk_live_test"
      }
    });

    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /invalid billing link/i);
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test("session response exposes active subscription state for billing management", async () => {
  for (const [subscriptionStatus, expected] of [["past_due", true], ["cancelled", false]]) {
    const response = await getSession({
      request: new Request("https://localboost4u.co.uk/me", {
        headers: { Cookie: "localboost_session=valid" }
      }),
      env: {
        DB: makeDb({
          session_id: 1,
          expires_at: future,
          id: 46,
          email: "customer@example.co.uk",
          business_name: "Example Business",
          plan: "unpaid",
          generations_used: 0,
          stripe_subscription_id: "sub_existing",
          subscription_status: subscriptionStatus
        })
      }
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.hasSubscription, expected);
  }
});
