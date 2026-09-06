/**
 * Admin API routes called as plain functions: login, users create/delete,
 * plan override, role, reset-link, settings. Run: npm run test:adminroutes
 *
 * Pins: every route is 403 without the panel cookie (a seller session is
 * not enough); login 401s bad credentials and issues the signed cookie;
 * create validates name/email/password, 201s, 409s a duplicate, honours
 * role; access override 400s garbage, 404s unknown, round-trips every
 * value and clears with null; role 400/404 and flips admin↔user; reset-link
 * 404s unknown, 400s the demo account, returns a working one-time URL with
 * emailed=false when mail is off; delete 404s unknown, refuses the demo
 * account, and really removes the user; settings 400s an empty patch, flips
 * magic_public and busts the static cache.
 *
 * next/headers and next/cache are stubbed (scripts/lib/next-stubs-loader.mjs)
 * so cookies() reads a jar this test fills. Throwaway db as in test-auth.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.ADMIN_PANEL_USER = "ops";
process.env.ADMIN_PANEL_PASSWORD = "s3cret-pw";
process.env.EBAY_TOKEN_KEY = "test-signing-key";
delete process.env.SMTP_HOST;

const work = mkdtempSync(path.join(tmpdir(), "cardflip-adminroutes-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const { revalidated } = await import("next/cache");
const login = await import(at("app/api/admin/login/route.ts"));
const users = await import(at("app/api/admin/users/route.ts"));
const userById = await import(at("app/api/admin/users/[id]/route.ts"));
const access = await import(at("app/api/admin/users/[id]/access/route.ts"));
const role = await import(at("app/api/admin/users/[id]/role/route.ts"));
const resetLink = await import(at("app/api/admin/users/[id]/reset-link/route.ts"));
const settings = await import(at("app/api/admin/settings/route.ts"));
const { ADMIN_COOKIE } = await import(at("lib/adminAuth.ts"));
const { SESSION_COOKIE } = await import(at("lib/server/auth.ts"));
const { createSession } = await import(at("lib/server/sessions.ts"));
const { ACCESS_OVERRIDES, DEMO_EMAIL, createUser, findUserById } = await import(at("lib/server/users.ts"));
const { consumeResetToken, peekResetToken } = await import(at("lib/server/passwordReset.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

let ipCounter = 0;
function req(method, body) {
  return new Request("http://test/api/admin", {
    method,
    headers: { "content-type": "application/json", "fly-client-ip": `10.1.0.${++ipCounter}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const status = async (p) => (await p).status;

// --- no cookie: everything is 403 ------------------------------------------
testCookies.clear();
check("users POST without cookie → 403", await status(users.POST(req("POST", { name: "x", email: "x@y.co", password: "123456" }))), 403);
check("settings GET without cookie → 403", await status(settings.GET()), 403);
check("access PATCH without cookie → 403", await status(access.PATCH(req("PATCH", { override: null }), ctx("nope"))), 403);
check("role PATCH without cookie → 403", await status(role.PATCH(req("PATCH", { role: "admin" }), ctx("nope"))), 403);
check("reset-link without cookie → 403", await status(resetLink.POST(req("POST", {}), ctx("nope"))), 403);
check("delete without cookie → 403", await status(userById.DELETE(req("DELETE"), ctx("nope"))), 403);

// A seller session (even an admin-role user) is not the panel cookie.
const seller = await createUser("Seller", "seller@example.com", "hunter22", "admin");
testCookies.set(SESSION_COOKIE, await createSession(seller.id));
check("seller session alone → still 403", await status(settings.GET()), 403);
testCookies.clear();

// --- login -------------------------------------------------------------------
check("login: wrong password → 401", await status(login.POST(req("POST", { username: "ops", password: "nope" }))), 401);
const ok = await login.POST(req("POST", { username: "OPS", password: "s3cret-pw" }));
check("login: good credentials → 200", ok.status, 200);
const cookie = ok.cookies.get(ADMIN_COOKIE);
check("login: signed httpOnly cookie issued", [Boolean(cookie?.value), cookie?.httpOnly], [true, true]);
testCookies.set(ADMIN_COOKIE, cookie.value);
check("with cookie: settings GET → 200", await status(settings.GET()), 200);

// --- create account ----------------------------------------------------------
check("create: name required", await status(users.POST(req("POST", { email: "a@b.co", password: "123456" }))), 400);
check("create: real email required", await status(users.POST(req("POST", { name: "A", email: "nope", password: "123456" }))), 400);
check("create: password floor", await status(users.POST(req("POST", { name: "A", email: "a@b.co", password: "12345" }))), 400);
const created = await users.POST(req("POST", { name: "  Pat  ", email: " Pat@Example.com ", password: "hunter22" }));
check("create: 201", created.status, 201);
const pat = (await created.json()).user;
check("create: normalised, no hash", [pat.name, pat.email, "passwordHash" in pat], ["Pat", "pat@example.com", false]);
check("create: duplicate → 409", await status(users.POST(req("POST", { name: "B", email: "PAT@example.com", password: "123456" }))), 409);
const adminMade = await (await users.POST(req("POST", { name: "Ops2", email: "ops2@example.com", password: "123456", role: "admin" }))).json();
check("create: role admin honoured", adminMade.user.role, "admin");
check("create: unknown role → user", (await (await users.POST(req("POST", { name: "U", email: "u@example.com", password: "123456", role: "god" }))).json()).user.role, "user");

// --- plan override -----------------------------------------------------------
check("access: garbage → 400", await status(access.PATCH(req("PATCH", { override: "vip" }), ctx(pat.id))), 400);
check("access: missing → 400", await status(access.PATCH(req("PATCH", {}), ctx(pat.id))), 400);
check("access: unknown user → 404", await status(access.PATCH(req("PATCH", { override: "trial" }), ctx("nope"))), 404);
const seen = [];
for (const value of ACCESS_OVERRIDES) {
  const res = await access.PATCH(req("PATCH", { override: value }), ctx(pat.id));
  seen.push([res.status, (await findUserById(pat.id)).accessOverride]);
}
check("access: every override round-trips", seen, ACCESS_OVERRIDES.map((v) => [200, v]));
await access.PATCH(req("PATCH", { override: null }), ctx(pat.id));
check("access: null clears", (await findUserById(pat.id)).accessOverride, null);

// --- role --------------------------------------------------------------------
check("role: garbage → 400", await status(role.PATCH(req("PATCH", { role: "owner" }), ctx(pat.id))), 400);
check("role: unknown user → 404", await status(role.PATCH(req("PATCH", { role: "admin" }), ctx("nope"))), 404);
check("role: make admin", (await (await role.PATCH(req("PATCH", { role: "admin" }), ctx(pat.id))).json()).user.role, "admin");
check("role: back to user", (await (await role.PATCH(req("PATCH", { role: "user" }), ctx(pat.id))).json()).user.role, "user");

// --- reset link --------------------------------------------------------------
check("reset-link: unknown → 404", await status(resetLink.POST(req("POST", {}), ctx("nope"))), 404);
const demo = await createUser("Demo", DEMO_EMAIL, "demo-pw", "user");
check("reset-link: demo → 400", await status(resetLink.POST(req("POST", {}), ctx(demo.id))), 400);
const issued = await (await resetLink.POST(req("POST", { send: true }), ctx(pat.id))).json();
const token = new URL(issued.url).searchParams.get("token");
check("reset-link: url carries a token, mail off → not emailed", [Boolean(token), issued.emailed, issued.mailConfigured, issued.expiresAt > Date.now()], [true, false, false, true]);
check("reset-link: token is valid for that user", (await peekResetToken(token))?.id, pat.id);
await consumeResetToken(token, "new-pass-99");
check("reset-link: one-time", await peekResetToken(token), null);

// --- delete ------------------------------------------------------------------
check("delete: unknown → 404", await status(userById.DELETE(req("DELETE"), ctx("nope"))), 404);
check("delete: demo refused → 400", await status(userById.DELETE(req("DELETE"), ctx(demo.id))), 400);
check("delete: 200", await status(userById.DELETE(req("DELETE"), ctx(pat.id))), 200);
check("delete: user gone", await findUserById(pat.id), null);

// --- settings ----------------------------------------------------------------
check("settings: magic off by default", (await (await settings.GET()).json()).magicPublic, false);
check("settings: empty patch → 400", await status(settings.PATCH(req("PATCH", { other: 1 }))), 400);
revalidated.length = 0;
check("settings: flip on", (await (await settings.PATCH(req("PATCH", { magicPublic: true }))).json()).magicPublic, true);
check("settings: static cache busted from the root layout", revalidated, [{ path: "/", type: "layout" }]);
check("settings: GET reads it back", (await (await settings.GET()).json()).magicPublic, true);
check("settings: flip off", (await (await settings.PATCH(req("PATCH", { magicPublic: false }))).json()).magicPublic, false);

// --- expired cookie ----------------------------------------------------------
testCookies.set(ADMIN_COOKIE, `${Date.now() - 1000}.deadbeef`);
check("expired/forged cookie → 403", await status(settings.GET()), 403);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
