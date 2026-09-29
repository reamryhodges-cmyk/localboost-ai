import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

test("new signup automatically signs in and continues the saved plan to checkout", async () => {
  const html = fs.readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
  const start = html.lastIndexOf("<script>") + "<script>".length;
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= "<script>".length && end > start, "homepage inline script exists");
  const script = html.slice(start, end);

  const elements = new Map();
  const listeners = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: "",
        textContent: "",
        disabled: false,
        attributes: {},
        addEventListener(type, callback) {
          listeners.set(id + ":" + type, callback);
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() {},
        scrollIntoView() {},
        appendChild() {}
      });
    }
    return elements.get(id);
  };

  const stored = new Map([["localboost_pending_plan", "business"]]);
  const sessionStorage = {
    getItem(key) { return stored.get(key) || null; },
    setItem(key, value) { stored.set(key, String(value)); },
    removeItem(key) { stored.delete(key); }
  };

  const requested = [];
  let meCalls = 0;
  let destination = "";
  const fetch = async (path, options = {}) => {
    requested.push(path);
    if (path === "/me") {
      meCalls += 1;
      return new Response(JSON.stringify(
        meCalls === 1
          ? { loggedIn: false }
          : { loggedIn: true, user: { email: "new@example.co.uk" } }
      ), { status: 200 });
    }
    if (path === "/signup") {
      return new Response(JSON.stringify({ success: true }), { status: 201 });
    }
    if (path === "/login") {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (path === "/create-checkout-session") {
      assert.equal(JSON.parse(options.body).plan, "business");
      return new Response(JSON.stringify({
        success: true,
        url: "https://checkout.stripe.com/c/pay_test"
      }), { status: 200 });
    }
    throw new Error("Unexpected request " + path);
  };

  const document = {
    getElementById: getElement,
    querySelectorAll: () => [],
    createElement: () => getElement("created-link")
  };
  const window = {
    location: {
      set href(value) { destination = value; },
      replace(value) { destination = value; }
    }
  };

  vm.runInNewContext(script, {
    document,
    window,
    fetch,
    sessionStorage,
    Response,
    console
  });

  await new Promise(resolve => setTimeout(resolve, 0));

  getElement("signupBusinessName").value = "Example Business";
  getElement("signupEmail").value = "new@example.co.uk";
  getElement("signupPassword").value = "a-strong-password";
  await listeners.get("signupButton:click")();

  assert.deepEqual(requested, [
    "/me",
    "/signup",
    "/login",
    "/me",
    "/create-checkout-session"
  ]);
  assert.equal(destination, "https://checkout.stripe.com/c/pay_test");
  assert.equal(stored.has("localboost_pending_plan"), false);
});
