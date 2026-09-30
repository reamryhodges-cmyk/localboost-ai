import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicPages = ["index.html", "demo.html", "privacy.html", "terms.html", "dashboard.html", "reset-password.html"];

function localPath(reference) {
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean || clean === "/") return "index.html";
  return clean.replace(/^\//, "");
}

test("public page links and local assets resolve inside the repository", () => {
  for (const page of publicPages) {
    const pageFile = path.join(root, page);
    assert.ok(fs.existsSync(pageFile), page + " exists");
    const html = fs.readFileSync(pageFile, "utf8");

    for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
      const ref = match[1];
      if (!ref.startsWith("/") || ref.startsWith("//") || ref.startsWith("/#")) continue;

      const target = localPath(ref);
      if (/\.html$/i.test(target) || /\.(?:png|svg|jpg|jpeg|webp|ico|css|js)$/i.test(target)) {
        assert.ok(fs.existsSync(path.join(root, target)), page + " points to missing local file " + ref);
      } else {
        assert.ok(
          fs.existsSync(path.join(root, "functions", target + ".js")) ||
          fs.existsSync(path.join(root, "functions", target, "index.js")),
          page + " points to missing Pages Function " + ref
        );
      }
    }
  }
});

test("homepage signup, login, reset and plan controls are wired to existing routes", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

  for (const id of ["signupButton", "loginButton", "resetButton", "pricingStatus"]) {
    assert.ok(html.includes('id="' + id + '"'), id + " exists");
  }

  for (const endpoint of ["/signup", "/login", "/forgot-password", "/me", "/create-checkout-session"]) {
    assert.ok(fs.existsSync(path.join(root, "functions", endpoint.slice(1) + ".js")), endpoint + " function exists");
  }

  for (const marker of ['$("signupButton").addEventListener', '$("loginButton").addEventListener', '$("resetButton").addEventListener', '".planButton"']) {
    assert.ok(script.includes(marker), "homepage binds " + marker);
  }
});

test("dashboard billing and logout controls match their Pages Functions", () => {
  const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

  for (const [id, endpoint, binding] of [
    ["billingPortalButton", "/create-billing-portal-session", '$("billingPortalButton").onclick'],
    ["logoutButton", "/logout", '$("logoutButton").onclick']
  ]) {
    assert.ok(html.includes('id="' + id + '"'), id + " exists");
    assert.ok(script.includes(endpoint), endpoint + " is called by the dashboard");
    assert.ok(script.includes(binding), id + " has a click handler");
    assert.ok(fs.existsSync(path.join(root, "functions", endpoint.slice(1) + ".js")), endpoint + " function exists");
  }
});

test("robots and sitemap expose public pages and keep account screens out of search", () => {
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/localboost4u\.co\.uk\/sitemap\.xml$/m);
  for (const privatePage of ["admin.html", "automation.html", "dashboard.html", "reset-password.html"]) {
    assert.match(robots, new RegExp("^Disallow: /" + privatePage.replace(".", "\\.") + "$", "m"));
  }

  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.ok(urls.includes("https://localboost4u.co.uk/"), "homepage is listed");
  assert.ok(urls.includes("https://localboost4u.co.uk/demo.html"), "public examples page is listed");
  for (const url of urls) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://localboost4u.co.uk", "sitemap uses the canonical host");
    const page = parsed.pathname === "/" ? "index.html" : parsed.pathname.slice(1);
    assert.ok(fs.existsSync(path.join(root, page)), "sitemap page exists: " + url);
  }
});
