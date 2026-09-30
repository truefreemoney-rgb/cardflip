// Country gate + cf_home travel pass (src/proxy.ts, src/lib/homeCookie.ts; Chris 09-30).
//   npm run test:countrygate
import path from "node:path";
import { pathToFileURL } from "node:url";

const at = (p) => pathToFileURL(path.join(process.cwd(), "src", p)).href;
let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n         got      ${JSON.stringify(got)}\n         expected ${JSON.stringify(want)}`}`);
  if (!ok) failed += 1;
}

process.env.VERCEL = "1";
process.env.GEO_COOKIE_SECRET = "test-geo-secret";
delete process.env.ALLOWED_COUNTRIES;
const { NextRequest } = await import("next/server");
const { proxy } = await import(at("proxy.ts"));
const { makeHomeCookie, readHomeCookie, homeCookieDue } = await import(at("lib/homeCookie.ts"));
const { allowedCountries, currencyFor } = await import(at("lib/countries.ts"));

function hit(url, country, { cookies = {}, ua, method = "GET" } = {}) {
  const headers = {};
  if (country) headers["x-vercel-ip-country"] = country;
  if (ua) headers["user-agent"] = ua;
  const jar = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (jar) headers.cookie = jar;
  return proxy(new NextRequest(new URL(url, "https://cardflip.io"), { headers, method }));
}
/** "open" | "waitlist" (page rewritten to /unavailable) | "403" | other status. */
function outcome(res) {
  const rewrite = res.headers.get("x-middleware-rewrite");
  if (rewrite) return new URL(rewrite).pathname === "/unavailable" ? "waitlist" : `rewrite ${rewrite}`;
  if (res.status === 403) return "403";
  return res.status === 200 ? "open" : String(res.status);
}

const SESSION = "a".repeat(64);
const pass = (home, session = SESSION, user = "u1") => ({ cardflip_session: session, cf_home: makeHomeCookie(user, home, session) });

// The six open countries.
for (const c of ["US", "CA", "GB", "IE", "AU", "NZ", "gb"]) check(`${c} visitor reaches /app`, outcome(hit("/app", c)), "open");

// Everyone else: waitlist screen on pages, 403 on APIs.
check("DE homepage → waitlist screen", outcome(hit("/", "DE")), "waitlist");
check("DE /cards page → waitlist screen", outcome(hit("/cards/pokemon/base/charizard-4", "DE")), "waitlist");
check("DE /signup → waitlist screen (no foreign signups)", outcome(hit("/signup", "DE")), "waitlist");
check("DE /api/auth/signup → 403", outcome(hit("/api/auth/signup", "DE", { method: "POST" })), "403");
check("DE /api/cards → 403", outcome(hit("/api/cards?q=x", "DE")), "403");
check("DE /api/fx → 403", outcome(hit("/api/fx", "DE")), "403");

// Exempt: the screen itself, the way back in, machine callers, crawl files.
for (const p of [
  "/unavailable", "/api/waitlist", "/api/geo", "/login", "/api/auth/login", "/api/auth/me", "/api/auth/logout",
  "/forgot-password", "/reset-password", "/api/auth/forgot", "/api/auth/reset", "/confirm-email", "/api/auth/verify-email",
  "/privacy", "/terms", "/robots.txt", "/sitemap.xml", "/sitemaps/cards-pokemon.xml", "/sw.js", "/manifest.webmanifest",
  "/opengraph-image", "/googleb77c2796ee19a2c8.html", "/tiktokWwS7fGv6FYzU7e27YEIzjd4aMmjwnCOd.txt",
  "/api/stripe/webhook", "/api/ebay/callback", "/api/cron/pokemon-prices", "/api/social/publish", "/api/ops/alert",
  "/api/runner/status", "/api/digest/unsubscribe",
]) check(`DE reaches exempt ${p}`, outcome(hit(p, "DE")), "open");
check("look-alike google file is not exempt", outcome(hit("/googleXYZ.html", "DE")), "waitlist");

// Travel pass.
check("DE + GB-home pass → /app open", outcome(hit("/app", "DE", { cookies: pass("GB") })), "open");
check("DE + GB-home pass → /api/cards open", outcome(hit("/api/cards?q=x", "DE", { cookies: pass("GB") })), "open");
check("DE + legacy (no home) pass → open", outcome(hit("/app", "DE", { cookies: pass(null) })), "open");
check("DE + DE-home pass → waitlist", outcome(hit("/app", "DE", { cookies: pass("DE") })), "waitlist");
check("FR + DE-home pass → 403 on API", outcome(hit("/api/cards", "FR", { cookies: pass("DE") })), "403");
const good = pass("GB");
check("pass without its session cookie → waitlist", outcome(hit("/app", "DE", { cookies: { cf_home: good.cf_home } })), "waitlist");
check("pass with a different session → waitlist", outcome(hit("/app", "DE", { cookies: { ...good, cardflip_session: "b".repeat(64) } })), "waitlist");
check("tampered home (GB→US) → waitlist", outcome(hit("/app", "DE", { cookies: { ...good, cf_home: good.cf_home.replace(".GB.", ".US.") } })), "waitlist");
check("tampered user id → waitlist", outcome(hit("/app", "DE", { cookies: { ...good, cf_home: good.cf_home.replace("v1.u1.", "v1.u2.") } })), "waitlist");
check("tampered signature → waitlist", outcome(hit("/app", "DE", { cookies: { ...good, cf_home: good.cf_home.slice(0, -2) + "xx" } })), "waitlist");
check("garbage cookie → waitlist", outcome(hit("/app", "DE", { cookies: { cardflip_session: SESSION, cf_home: "v1.u1.GB" } })), "waitlist");
const old = makeHomeCookie("u1", "GB", SESSION, Date.now() - 31 * 24 * 3600 * 1000);
check("expired pass (31 days) → waitlist", outcome(hit("/app", "DE", { cookies: { cardflip_session: SESSION, cf_home: old } })), "waitlist");
check("readHomeCookie round-trips", readHomeCookie(good.cf_home, SESSION)?.home, "GB");
check("pass due when missing", homeCookieDue(undefined, "u1", "GB", SESSION), true);
check("pass not due when fresh + matching", homeCookieDue(good.cf_home, "u1", "GB", SESSION), false);
check("pass due when home changed", homeCookieDue(good.cf_home, "u1", "CA", SESSION), true);
check("pass due for another session", homeCookieDue(good.cf_home, "u1", "GB", "c".repeat(64)), true);

// Crawlers: pages only, GET only.
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
check("Googlebot from DE gets the real card page", outcome(hit("/cards/pokemon/base/charizard-4", "DE", { ua: GOOGLEBOT })), "open");
check("Googlebot UA from DE still 403 on /api", outcome(hit("/api/cards", "DE", { ua: GOOGLEBOT })), "403");
check("Googlebot UA POST from DE → waitlist", outcome(hit("/signup", "DE", { ua: GOOGLEBOT, method: "POST" })), "waitlist");

// Untouched: dev (no header), India block, admin geofence.
check("no country header (dev/tests) → open", outcome(hit("/app", null)), "open");
check("IN still a plain 403", hit("/", "IN").status, 403);
check("admin still US-only (GB → 404)", hit("/admin", "GB").status, 404);
check("admin from DE → 404, not the waitlist", hit("/admin", "DE").status, 404);

// Env + currency.
check("default open list", [...allowedCountries(undefined)].sort(), ["AU", "CA", "GB", "IE", "NZ", "US"]);
check("ALLOWED_COUNTRIES=* turns the gate off", allowedCountries("*"), "*");
check("custom list", [...allowedCountries("us, ca")], ["US", "CA"]);
check("currency by home", ["US", "CA", "GB", "IE", "AU", "NZ", "DE", null].map(currencyFor), ["USD", "CAD", "GBP", "EUR", "AUD", "NZD", "USD", "USD"]);

// No signing key: the gate stays open rather than locking members out (fresh import).
delete process.env.GEO_COOKIE_SECRET;
delete process.env.CRON_SECRET;
const bare = await import(at("proxy.ts") + "?nokey");
const res = bare.proxy(new NextRequest(new URL("/app", "https://cardflip.io"), { headers: { "x-vercel-ip-country": "DE" } }));
check("no signing key → gate open", outcome(res), "open");

delete process.env.VERCEL;
console.log(failed ? `\n${failed} country-gate check(s) failed` : "\nAll country-gate checks passed");
process.exit(failed ? 1 : 0);
