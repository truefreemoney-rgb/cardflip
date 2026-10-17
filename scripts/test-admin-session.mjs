/**
 * #32 (audit 10-16): the admin console's sign-out really ends the session, touches can't keep a session alive
 * forever, and production never signs sessions with a built-in secret.
 * Run: npm run test:adminsession
 *
 * Pins:
 *  - Sign Out records the sign-in: the cookie, a copy taken before it, and a copy re-signed by a touch are all
 *    refused; a different sign-in (another browser) keeps working;
 *  - a touch keeps the sign-in time, so the hard limit (owner 7 days, helper 12 h) counts from the login;
 *  - tokens in the old two-part format (no sign-in time) are refused;
 *  - production with no EBAY_TOKEN_KEY / EBAY_CLIENT_SECRET: login answers 503 and no token ever verifies;
 *    local dev without them still signs in.
 *
 * Throwaway db; next/headers is stubbed so the gate reads the cookie jar this test fills.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";

process.env.ADMIN_PANEL_USER = "ops";
process.env.ADMIN_PANEL_PASSWORD = "s3cret-pw";
process.env.EBAY_TOKEN_KEY = "test-signing-key";
delete process.env.SMTP_HOST;
delete process.env.VERCEL_ENV;

const work = mkdtempSync(path.join(tmpdir(), "cardflip-adminsession-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
console.warn = () => {};
console.error = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const login = await import(at("app/api/admin/login/route.ts"));
const logout = await import(at("app/api/admin/logout/route.ts"));
const touch = await import(at("app/api/admin/touch/route.ts"));
const { adminRole } = await import(at("lib/server/adminGate.ts"));
const auth = await import(at("lib/adminAuth.ts"));
const { ADMIN_COOKIE, ADMIN_MAX_LIFE_MS, HELPER_MAX_LIFE_MS, adminCredentials, adminSessionOf, signAdminToken, signHelperToken, helperCredentials, verifyAdminToken } = auth;
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}
let ip = 0;
const req = (body) =>
  new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": `10.8.${++ip}.1` }, body: JSON.stringify(body) });
async function signIn() {
  const res = await login.POST(req({ username: "ops", password: "s3cret-pw" }));
  return res.cookies.get(ADMIN_COOKIE)?.value ?? null;
}
const roleWith = async (cookie) => {
  testCookies.set(ADMIN_COOKIE, cookie);
  return adminRole();
};

console.log("Sign Out ends the session everywhere");
{
  const a = await signIn();
  await new Promise((r) => setTimeout(r, 5)); // sign-ins are told apart by their millisecond
  const b = await signIn(); // another browser, its own sign-in
  check("two sign-ins, both owner", [await roleWith(a), await roleWith(b)], ["owner", "owner"]);
  await new Promise((r) => setTimeout(r, 5));
  testCookies.set(ADMIN_COOKIE, a);
  const t = await touch.POST();
  const touched = t.cookies.get(ADMIN_COOKIE).value;
  check("a touch re-signs a different cookie for the SAME sign-in", [touched !== a, adminSessionOf(touched).loginAt === adminSessionOf(a).loginAt], [true, true]);
  testCookies.set(ADMIN_COOKIE, touched);
  const out = await logout.POST();
  check("Sign Out: 200 and the cookie is cleared", [out.status, out.cookies.get(ADMIN_COOKIE)?.value ?? null], [200, ""]);
  check("the signed-out cookie, the copy from before the touch: both refused", [await roleWith(touched), await roleWith(a)], [null, null]);
  testCookies.set(ADMIN_COOKIE, a);
  check("...and a touch with the old copy can't revive it", (await touch.POST()).status, 401);
  check("the other browser's sign-in is untouched", await roleWith(b), "owner");
  check("a fresh sign-in after Sign Out works", await roleWith(await signIn()), "owner");
}

console.log("Hard limit from the sign-in");
{
  const creds = adminCredentials();
  const login0 = 1_700_000_000_000;
  // Touched every few hours for 8 days: the re-signs never pass the 7-day mark, and the session ends there.
  let tok = signAdminToken(login0, creds, process.env, login0);
  let alive = true;
  let lastOk = login0;
  for (let t = login0 + 4 * 3600_000; t < login0 + 8 * 24 * 3600_000; t += 4 * 3600_000) {
    const s = adminSessionOf(tok.token, t);
    if (!s) { alive = false; break; }
    lastOk = t;
    tok = signAdminToken(t, creds, process.env, s.loginAt);
  }
  check("touched every 4 h: the owner session ends at 7 days, not later", [alive, lastOk <= login0 + ADMIN_MAX_LIFE_MS, lastOk > login0 + ADMIN_MAX_LIFE_MS - 5 * 3600_000], [false, true, true]);
  check("a re-sign near the end is capped at the 7-day mark", signAdminToken(login0 + ADMIN_MAX_LIFE_MS - 1000, creds, process.env, login0).expiresAt, login0 + ADMIN_MAX_LIFE_MS);
  // A token claiming a sign-in 8 days ago but freshly expiring (forged by hand) fails the MAC; even well-formed it's past the limit.
  const forged = `${login0 + 8 * 24 * 3600_000 + 1000}.${login0}.AAAA`;
  check("past the limit: refused", adminSessionOf(forged, login0 + 8 * 24 * 3600_000), null);
  const henv = { ...process.env, ADMIN_HELPER_USER: "sam", ADMIN_HELPER_PASSWORD: "helper-pw" };
  let h = signHelperToken(login0, helperCredentials(henv), henv, login0);
  let hLast = login0;
  for (let t = login0 + 4 * 60_000; t < login0 + 13 * 3600_000; t += 4 * 60_000) {
    const s = adminSessionOf(h.token, t, henv);
    if (!s) break;
    hLast = t;
    h = signHelperToken(t, helperCredentials(henv), henv, s.loginAt);
  }
  check("helper touched every 4 min: ends at 12 h", hLast <= login0 + HELPER_MAX_LIFE_MS && hLast > login0 + HELPER_MAX_LIFE_MS - 10 * 60_000, true);
}

console.log("Old token format");
{
  const creds = adminCredentials();
  const now = Date.now();
  const exp = now + 3600_000;
  // The pre-#32 owner token: "<expiresAt>.<hmac>", signed the old way.
  const key = createHmac("sha256", `${creds.user}:${creds.password}:${process.env.EBAY_TOKEN_KEY}`).update("admin-session-key").digest();
  const old = `${exp}.${createHmac("sha256", key).update(String(exp)).digest("base64url")}`;
  check("a two-part token from before the change is refused (one fresh sign-in after deploy)", [verifyAdminToken(old, now), await roleWith(old)], [false, null]);
}

console.log("No built-in secret on production");
{
  const prod = { NODE_ENV: "production", ADMIN_PANEL_USER: "ops", ADMIN_PANEL_PASSWORD: "s3cret-pw" };
  const c = adminCredentials(prod);
  check("prod, no EBAY_TOKEN_KEY/EBAY_CLIENT_SECRET: sessions unavailable", auth.adminSessionsAvailable(prod), false);
  check("...a token signed there never verifies", verifyAdminToken(signAdminToken(Date.now(), c, prod).token, Date.now() + 1000, c, prod), false);
  check("...nor one signed with the old 'cardflip' fallback", (() => {
    const now = Date.now();
    const key = createHmac("sha256", `ops:s3cret-pw:cardflip`).update("admin-session-key").digest();
    const exp = now + 3600_000;
    const tok = `${exp}.${now}.${createHmac("sha256", key).update(`${exp}.${now}`).digest("base64url")}`;
    return verifyAdminToken(tok, now + 1000, c, prod);
  })(), false);
  check("prod with EBAY_TOKEN_KEY: available", auth.adminSessionsAvailable({ ...prod, EBAY_TOKEN_KEY: "k" }), true);
  check("local dev with neither: still available (dev-only value)", auth.adminSessionsAvailable({ NODE_ENV: "development" }), true);
  const saved = { node: process.env.NODE_ENV, key: process.env.EBAY_TOKEN_KEY };
  process.env.NODE_ENV = "production";
  delete process.env.EBAY_TOKEN_KEY;
  delete process.env.EBAY_CLIENT_SECRET;
  const res = await login.POST(req({ username: "ops", password: "s3cret-pw" }));
  check("login route on such a server: 503, no cookie", [res.status, res.cookies.get(ADMIN_COOKIE)?.value ?? null], [503, null]);
  process.env.NODE_ENV = saved.node;
  process.env.EBAY_TOKEN_KEY = saved.key;
}

check("sign-out rows are kept only until the session would have died", (await db.prepare("SELECT COUNT(*) AS n FROM admin_logouts WHERE until > ?").get(Date.now())).n >= 1, true);

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll admin session checks passed.");
