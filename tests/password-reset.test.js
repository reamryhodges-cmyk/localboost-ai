import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { onRequestPost as sendReset } from "../functions/forgot-password.js";
import { onRequestPost as completeReset } from "../functions/reset-password.js";

const future = new Date(Date.now() + 60_000).toISOString();

function makeDb({ user = null, recent = null, reset = null } = {}) {
  const db = { statements: [], queries: [] };
  db.prepare = function (sql) {
    return {
      async run() { return { success: true }; },
      bind(...params) {
        const statement = { sql, params };
        db.queries.push(statement);
        return {
          async first() {
            if (/FROM users/i.test(sql)) return user;
            if (/created_at >= datetime/i.test(sql)) return recent;
            if (/FROM password_reset_tokens/i.test(sql)) return reset;
            return null;
          },
          async run() { return { success: true }; },
          ...statement
        };
      }
    };
  };
  db.batch = async statements => { db.statements = statements; return []; };
  return db;
}

function post(url, body) {
  return new Request("https://localboost4u.co.uk" + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("password reset email contains a working reset page link", async () => {
  const oldFetch = globalThis.fetch;
  let email;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    email = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
  };

  try {
    const response = await sendReset({
      request: post("/forgot-password", { email: "customer@example.co.uk" }),
      env: {
        DB: makeDb({ user: { id: 91 } }),
        RESEND_API_KEY: "re_test"
      }
    });

    assert.equal(response.status, 200);
    assert.match(email.text, /https:\/\/localboost4u\.co\.uk\/reset-password\.html#token=[a-f0-9]{64}/i);
    assert.match(email.html, /href="https:\/\/localboost4u\.co\.uk\/reset-password\.html#token=[a-f0-9]{64}"/i);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("reset page reads the email token and posts the new password", async () => {
  const html = fs.readFileSync(fileURLToPath(new URL("../reset-password.html", import.meta.url)), "utf8");
  const start = html.lastIndexOf("<script>") + "<script>".length;
  const end = html.lastIndexOf("</script>");
  const script = html.slice(start, end);
  const token = "a".repeat(64);
  const elements = new Map();
  const listeners = new Map();
  const getElement = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: "",
        textContent: "",
        innerHTML: "",
        disabled: false,
        addEventListener(type, callback) { listeners.set(id + ":" + type, callback); }
      });
    }
    return elements.get(id);
  };
  let requestBody;
  const fetch = async (url, options) => {
    assert.equal(url, "/reset-password");
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  const document = { getElementById: getElement, querySelectorAll: () => [] };
  const history = { replaceState(_state, _title, url) { assert.equal(url, "/reset-password.html"); } };

  vm.runInNewContext(script, {
    URLSearchParams,
    location: { hash: "#token=" + token, pathname: "/reset-password.html" },
    history,
    document,
    fetch,
    Response,
    console
  });

  getElement("password").value = "new-strong-password";
  getElement("confirmPassword").value = "new-strong-password";
  await listeners.get("resetButton:click")();

  assert.deepEqual(requestBody, { token, password: "new-strong-password" });
  assert.match(getElement("status").innerHTML, /Password updated/);
});

test("reset endpoint accepts a live token, updates the password and revokes sessions", async () => {
  const db = makeDb({
    reset: { id: 12, user_id: 91, expires_at: future }
  });
  const response = await completeReset({
    request: post("/reset-password", {
      token: "b".repeat(64),
      password: "new-strong-password"
    }),
    env: { DB: db }
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(db.statements.length, 3);
  const sql = db.statements.map(statement => statement.sql).join("\n");
  assert.match(sql, /UPDATE users SET password_hash/);
  assert.match(sql, /UPDATE password_reset_tokens/);
  assert.match(sql, /DELETE FROM sessions/);
  assert.match(db.statements[0].params[0], /^pbkdf2-sha256\$100000\$/);
});

test("reset endpoint rejects expired tokens without changing the account", async () => {
  const db = makeDb({
    reset: { id: 12, user_id: 91, expires_at: new Date(Date.now() - 1000).toISOString() }
  });
  const response = await completeReset({
    request: post("/reset-password", {
      token: "c".repeat(64),
      password: "new-strong-password"
    }),
    env: { DB: db }
  });

  assert.equal(response.status, 400);
  assert.equal(db.statements.length, 0);
});
