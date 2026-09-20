import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as signup } from "../functions/signup.js";
import { onRequestPost as login } from "../functions/login.js";
import { onRequestPost as logout } from "../functions/logout.js";
import { onRequestPost as forgotPassword } from "../functions/forgot-password.js";
import { onRequestPost as resetPassword } from "../functions/reset-password.js";

function request(path, body, cookie = "") {
  return new Request(`https://localboost4u.co.uk/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function fakeStatement(handler, sql) {
  let values = [];
  return {
    bind(...nextValues) {
      values = nextValues;
      return this;
    },
    first() {
      return handler("first", sql, values);
    },
    run() {
      return handler("run", sql, values);
    }
  };
}

async function legacyHash(password) {
  const salt = new Uint8Array(16).fill(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  const hex = bytes => Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex(salt)}:${hex(new Uint8Array(hash))}`;
}

test("signup requires a business name", async () => {
  const response = await signup({
    request: request("signup", {
      businessName: "",
      email: "owner@example.com",
      password: "correct horse battery staple"
    }),
    env: {}
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Business name/i);
});

test("login accepts a legacy password then upgrades its hash", async () => {
  const updates = [];
  const user = {
    id: 1,
    email: "owner@example.com",
    password_hash: await legacyHash("correct horse battery staple"),
    business_name: "Test Business",
    plan: "starter",
    generations_used: 0
  };
  const handler = async (operation, sql, values) => {
    if (operation === "first" && sql.includes("FROM users")) return user;
    if (operation === "run" && sql.includes("UPDATE users")) updates.push(values[0]);
    return { success: true };
  };
  const env = { DB: { prepare: sql => fakeStatement(handler, sql) } };

  const response = await login({
    request: request("login", {
      email: user.email,
      password: "correct horse battery staple"
    }),
    env
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(updates.length, 1);
  assert.match(updates[0], /^pbkdf2-sha256\$100000\$/);
});

test("signup saves a required business name with a versioned hash", async () => {
  const inserts = [];
  const handler = async (operation, sql, values) => {
    if (operation === "first" && sql.includes("FROM users")) return null;
    if (operation === "run" && sql.includes("INSERT INTO users")) {
      inserts.push(values);
      return { meta: { last_row_id: 42 } };
    }
    return { success: true };
  };
  const env = { DB: { prepare: sql => fakeStatement(handler, sql) } };
  const response = await signup({
    request: request("signup", {
      businessName: "Test Business",
      email: "new-owner@example.com",
      password: "correct horse battery staple"
    }),
    env
  });
  assert.equal(response.status, 201);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][0], "new-owner@example.com");
  assert.match(inserts[0][1], /^pbkdf2-sha256\$100000\$/);
  assert.equal(inserts[0][2], "Test Business");
});

test("login rejects a wrong password without exposing internals", async () => {
  const user = {
    id: 1,
    email: "owner@example.com",
    password_hash: await legacyHash("right password"),
    business_name: "Test Business",
    plan: "starter",
    generations_used: 0
  };
  const handler = async operation => operation === "first" ? user : { success: true };
  const env = { DB: { prepare: sql => fakeStatement(handler, sql) } };
  const response = await login({
    request: request("login", { email: user.email, password: "wrong password" }),
    env
  });
  const result = await response.json();
  assert.equal(response.status, 401);
  assert.equal(result.error, "Invalid email or password.");
  assert.equal(result.details, undefined);
});

test("logout revokes the server session and clears the cookie", async () => {
  const deletedTokens = [];
  const handler = async (operation, sql, values) => {
    if (operation === "run" && sql.includes("DELETE FROM sessions")) {
      deletedTokens.push(values[0]);
    }
    return { success: true };
  };
  const env = { DB: { prepare: sql => fakeStatement(handler, sql) } };
  const response = await logout({
    request: request("logout", undefined, "localboost_session=secret-token"),
    env
  });
  assert.equal(response.status, 200);
  assert.deepEqual(deletedTokens, ["secret-token"]);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("forgot password does not reveal whether an account exists", async () => {
  const response = await forgotPassword({
    request: request("forgot-password", { email: "not-an-email" }),
    env: {}
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.match(result.message, /If that account exists/i);
});

test("reset password rejects malformed tokens before database access", async () => {
  const response = await resetPassword({
    request: request("reset-password", {
      token: "not-a-valid-token",
      password: "new secure password"
    }),
    env: {}
  });
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.match(result.error, /invalid or expired/i);
});
