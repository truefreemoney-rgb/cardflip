/**
 * /api/waitlist + the login travel rule + /api/auth/me travel pass, called as
 * plain functions on a throwaway db (Chris 09-30). Run: npm run test:waitlist
 *
 * Pins: the honeypot stores nothing but still says ok; a bad email 400s; a
 * duplicate email is one row; the country comes from x-vercel-ip-country and
 * never the body. Login from outside the open countries refuses a foreign-home
 * account (403 unavailable) and lets a GB-home and a legacy (NULL) account in
 * with a cf_home bound to the new session; signup stamps home_country; /me
 * issues cf_home to a session that has none (signed in before the gate).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.GEO_COOKIE_SECRET = "test-geo-secret";
delete process.env.SMTP_HOST;
const work = mkdtempSync(path.join(tmpdir(), "cardflip-waitlist-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const { db } = await import(at("lib/db.ts"));
const waitlist = await import(at("app/api/waitlist/route.ts"));
const loginRoute = await import(at("app/api/auth/login/route.ts"));
const signupRoute = await import(at("app/api/auth/signup/route.ts"));
const meRoute = await import(at("app/api/auth/me/route.ts"));
const { createUser, findUserByEmail } = await import(at("lib/server/users.ts"));
const { readHomeCookie } = await import(at("lib/homeCookie.ts"));

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n         got      ${JSON.stringify(got)}\n         expected ${JSON.stringify(want)}`}`);
  if (!ok) failed += 1;
}
let ip = 10;
const post = (url, body, country) =>
  new Request(`https://cardflip.io${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ip++}`, ...(country ? { "x-vercel-ip-country": country } : {}) },
    body: JSON.stringify(body),
  });
const rows = async () => (await db.prepare("SELECT email, country FROM waitlist ORDER BY email").all()).map((r) => [r.email, r.country]);

// Waitlist.
let res = await waitlist.POST(post("/api/waitlist", { email: "bot@example.com", website: "http://spam" }, "DE"));
check("honeypot → 200", res.status, 200);
check("honeypot stores nothing", await rows(), []);
res = await waitlist.POST(post("/api/waitlist", { email: "not-an-email" }, "DE"));
check("bad email → 400", res.status, 400);
res = await waitlist.POST(post("/api/waitlist", { email: "Hans@Example.de", country: "US" }, "DE"));
check("valid → 200", res.status, 200);
res = await waitlist.POST(post("/api/waitlist", { email: "hans@example.de" }, "FR"));
check("duplicate → same 200", res.status, 200);
check("one row, lower-cased, header country wins over body", await rows(), [["hans@example.de", "DE"]]);

// Login travel rule.
await createUser("Gert", "gert@example.de", "password1", "user", { homeCountry: "DE" });
await createUser("Grace", "grace@example.co.uk", "password1", "user", { homeCountry: "GB" });
await createUser("Lee", "legacy@example.com", "password1", "user");
const cookieOf = (r, name) => r.cookies.get(name)?.value ?? null;

res = await loginRoute.POST(post("/api/auth/login", { email: "gert@example.de", password: "password1" }, "DE"));
check("DE-home account from DE → 403", res.status, 403);
check("… marked unavailable", (await res.json()).unavailable, true);
check("… no session issued", cookieOf(res, "cardflip_session"), null);
res = await loginRoute.POST(post("/api/auth/login", { email: "gert@example.de", password: "password1" }, "US"));
check("DE-home account from the US → 200 (IP is open)", res.status, 200);
res = await loginRoute.POST(post("/api/auth/login", { email: "grace@example.co.uk", password: "password1" }, "DE"));
check("GB-home account from DE → 200", res.status, 200);
const session = cookieOf(res, "cardflip_session");
check("… cf_home bound to that session says GB", readHomeCookie(cookieOf(res, "cf_home"), session)?.home, "GB");
res = await loginRoute.POST(post("/api/auth/login", { email: "legacy@example.com", password: "password1" }, "DE"));
check("legacy (no home) account from DE → 200", res.status, 200);
check("… cf_home carries no home", readHomeCookie(cookieOf(res, "cf_home"), cookieOf(res, "cardflip_session"))?.home, null);
res = await loginRoute.POST(post("/api/auth/login", { email: "gert@example.de", password: "wrong" }, "DE"));
check("wrong password from DE is still the plain 401", res.status, 401);

// Signup stamps home_country.
res = await signupRoute.POST(post("/api/auth/signup", { name: "Ava", email: "ava@example.com.au", password: "password1" }, "AU"));
check("signup from AU → 201", res.status, 201);
check("… home_country AU", (await findUserByEmail("ava@example.com.au"))?.homeCountry, "AU");
check("… cf_home says AU", readHomeCookie(cookieOf(res, "cf_home"), cookieOf(res, "cardflip_session"))?.home, "AU");

// /me hands a pass to a session signed in before the gate shipped.
// /me calls after() for the daily refresh (off Vercel) and the seen stamp; neither exists outside a request.
process.env.VERCEL = "1";
await db.prepare("UPDATE users SET last_seen_at = ? WHERE email = ?").run(Date.now(), "grace@example.co.uk");
testCookies.clear();
testCookies.set("cardflip_session", session);
res = await meRoute.GET();
check("/me with a session and no cf_home issues one", readHomeCookie(cookieOf(res, "cf_home"), session)?.home, "GB");

console.log(failed ? `\n${failed} waitlist/travel check(s) failed` : "\nAll waitlist/travel checks passed");
process.exit(failed ? 1 : 0);
