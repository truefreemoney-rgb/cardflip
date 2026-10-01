/**
 * Admin API routes called as plain functions: login, users create/delete,
 * plan override, role, reset-link, settings. Run: npm run test:adminroutes
 *
 * Pins: every route is 403 without the panel cookie (a seller session is
 * not enough); login 401s bad credentials and issues the signed cookie;
 * create validates name/email/password, 201s, 409s a duplicate, honours
 * role; access override 400s garbage, 404s unknown, round-trips every
 * value and clears with null; role 400/404 and flips admin↔user; reset-link
 * 404s unknown, returns a working one-time URL with emailed=false when mail
 * is off; delete 404s unknown and really removes the user; settings 400s an
 * empty patch, flips magic_public and busts the static cache.
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
const verifyEmail = await import(at("app/api/admin/users/[id]/verify-email/route.ts"));
const scansRoute = await import(at("app/api/admin/users/[id]/scans/route.ts"));
const settings = await import(at("app/api/admin/settings/route.ts"));
const { getSetting } = await import(at("lib/server/settings.ts"));
const { ADMIN_COOKIE } = await import(at("lib/adminAuth.ts"));
const { SESSION_COOKIE } = await import(at("lib/server/auth.ts"));
const { createSession } = await import(at("lib/server/sessions.ts"));
const { ACCESS_OVERRIDES, createUser, findUserById } = await import(at("lib/server/users.ts"));
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
check("scans POST without cookie → 403", await status(scansRoute.POST(req("POST", { delta: 5, note: "x y z" }), ctx("nope"))), 403);
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

// --- login + emailed code (owner, live site only; Chris 09-30) ----------------
{
  const { devLastLoginCode } = await import(at("lib/server/loginCode.ts"));
  const { OWNER_EMAIL } = await import(at("lib/server/users.ts"));
  const { db } = await import(at("lib/db.ts"));
  const ownerLogin = (extra = {}) => login.POST(req("POST", { username: "ops", password: "s3cret-pw", ...extra }));
  process.env.VERCEL_ENV = "production";
  const noMail = await ownerLogin();
  check("console code: no way to mail it → 503 and no cookie", [noMail.status, noMail.cookies.get(ADMIN_COOKIE)?.value ?? null], [503, null]);
  check("console code: …and no half-made code is left behind", (await db.prepare("SELECT COUNT(*) AS n FROM admin_login_codes").get()).n, 0);
  process.env.EMAIL_CONFIRM_DEV_ECHO = "1";
  const asked = await ownerLogin();
  const askedBody = await asked.json();
  check("console code: the password alone gets a code mailed, not a cookie", [asked.status, askedBody.codeRequired, asked.cookies.get(ADMIN_COOKIE)?.value ?? null], [401, true, null]);
  check("console code: the answer shows the owner's inbox masked", [askedBody.error.includes("t***@gmail.com"), askedBody.error.includes(OWNER_EMAIL)], [true, false]);
  const code = devLastLoginCode(OWNER_EMAIL);
  check("console code: six digits, mailed to the owner", /^\d{6}$/.test(code ?? ""), true);
  const wrongPw = await (await login.POST(req("POST", { username: "ops", password: "nope", code }))).json();
  check("console code: a wrong password never reaches the code step", [wrongPw.error, wrongPw.codeRequired ?? null], ["Incorrect username or password.", null]);
  const wrong = await ownerLogin({ code: code === "000000" ? "000001" : "000000" });
  check("console code: wrong code refused, no cookie", [wrong.status, (await wrong.json()).codeRequired, wrong.cookies.get(ADMIN_COOKIE)?.value ?? null], [401, true, null]);
  const good = await ownerLogin({ code });
  check("console code: the right code signs in as owner", [good.status, (await good.json()).role, Boolean(good.cookies.get(ADMIN_COOKIE)?.value)], [200, "owner", true]);
  check("console code: a code works once", (await ownerLogin({ code })).status, 401);
  process.env.ADMIN_HELPER_USER = "sam";
  process.env.ADMIN_HELPER_PASSWORD = "helper-pw-1";
  const helper = await login.POST(req("POST", { username: "sam", password: "helper-pw-1" }));
  check("console code: the helper (Tasks only) is not asked", [helper.status, (await helper.json()).role], [200, "helper"]);
  delete process.env.ADMIN_HELPER_USER;
  delete process.env.ADMIN_HELPER_PASSWORD;
  delete process.env.EMAIL_CONFIRM_DEV_ECHO;
  // Break-glass: with mail down, the settings row admin_login_code = "0" lets the owner's password in.
  // "ops" has used most of its 10 tries above: clear both limiters (memory, then the shared table).
  (await import(at("lib/server/rateLimit.ts")))._resetRateLimits();
  await db.prepare("DELETE FROM rate_limits").run();
  check("console code switch: mail down and no row → still locked", (await ownerLogin()).status, 503);
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('admin_login_code', '0', 0)").run();
  const open = await ownerLogin();
  check("console code switch: \"0\" → the password signs in as owner", [open.status, (await open.json()).role, Boolean(open.cookies.get(ADMIN_COOKIE)?.value)], [200, "owner", true]);
  check("console code switch: a wrong password is still refused", await status(login.POST(req("POST", { username: "ops", password: "nope" }))), 401);
  await db.prepare("DELETE FROM settings WHERE key = 'admin_login_code'").run();
  check("console code switch: row gone → the code is back", (await ownerLogin()).status, 503);
  delete process.env.VERCEL_ENV;
  check("console code: off the live site the password is enough", (await ownerLogin()).status, 200);
}

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

// --- adjust scans (Chris refunds a payment, a goodwill grant, a fix): a ledger row of kind admin ---
for (const bad of [{ note: "why not" }, { delta: 0, note: "why not" }, { delta: 2.5, note: "why not" }, { delta: "5", note: "why not" }, { delta: 200_000, note: "why not" }]) {
  check(`scans: ${JSON.stringify(bad)} → 400`, await status(scansRoute.POST(req("POST", bad), ctx(pat.id))), 400);
}
check("scans: a note is required", await status(scansRoute.POST(req("POST", { delta: 5 }), ctx(pat.id))), 400);
check("scans: unknown user → 404", await status(scansRoute.POST(req("POST", { delta: 5, note: "goodwill" }), ctx("nope"))), 404);
const grant = await scansRoute.POST(req("POST", { delta: 40, note: "goodwill for the outage" }), ctx(pat.id));
const grantBody = await grant.json();
check("scans: +40 lands on the balance and in the ledger", [grant.status, grantBody.applied, grantBody.balanceAfter, (await findUserById(pat.id)).planScans, grantBody.ledger[0].kind, grantBody.ledger[0].note], [200, 40, 40, 40, "admin", "goodwill for the outage"]);
const take = await (await scansRoute.POST(req("POST", { delta: -100, note: "refunded the payment" }), ctx(pat.id))).json();
check("scans: a take-back floors at zero and the ledger keeps what was asked", [take.applied, take.balanceAfter, (await findUserById(pat.id)).planScans, take.ledger[0].scans, take.ledger[0].applied], [-40, 0, 0, -100, -40]);

// --- role --------------------------------------------------------------------
check("role: garbage → 400", await status(role.PATCH(req("PATCH", { role: "owner" }), ctx(pat.id))), 400);
check("role: unknown user → 404", await status(role.PATCH(req("PATCH", { role: "admin" }), ctx("nope"))), 404);
check("role: make admin", (await (await role.PATCH(req("PATCH", { role: "admin" }), ctx(pat.id))).json()).user.role, "admin");
check("role: back to user", (await (await role.PATCH(req("PATCH", { role: "user" }), ctx(pat.id))).json()).user.role, "user");

// --- reset link --------------------------------------------------------------
check("reset-link: unknown → 404", await status(resetLink.POST(req("POST", {}), ctx("nope"))), 404);
const issued = await (await resetLink.POST(req("POST", { send: true }), ctx(pat.id))).json();
const token = new URL(issued.url).searchParams.get("token");
check("reset-link: url carries a token, mail off → not emailed", [Boolean(token), issued.emailed, issued.mailConfigured, issued.expiresAt > Date.now()], [true, false, false, true]);
check("reset-link: token is valid for that user", (await peekResetToken(token))?.id, pat.id);
await consumeResetToken(token, "new-pass-99");
check("reset-link: one-time", await peekResetToken(token), null);

// --- delete ------------------------------------------------------------------
check("delete: unknown → 404", await status(userById.DELETE(req("DELETE"), ctx("nope"))), 404);
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

// --- email confirmation (09-30): Mark Confirmed and the switch ------------------
const waiting = await createUser("Waiting", "waiting@example.com", "hunter22", "user", { emailPending: true });
const waiting2 = await createUser("Waiting Too", "waiting2@example.com", "hunter22", "user", { emailPending: true });
const waiting3 = await createUser("Waiting Three", "waiting3@example.com", "hunter22", "user", { emailPending: true });
delete process.env.EMAIL_CONFIRM_DEV_ECHO;
check("email switch: no row means off", (await getSetting("email_confirm")), null);
check("email switch: GET reports it off with nobody released yet", [(await (await settings.GET()).json()).emailConfirm.on, (await (await settings.GET()).json()).emailConfirm.deliverable], [false, false]);
check("email switch: turning it on with no mail set up is refused (400)", await status(settings.PATCH(req("PATCH", { emailConfirm: true }))), 400);
check("email switch: ...and wrote nothing", await getSetting("email_confirm"), null);
process.env.EMAIL_CONFIRM_DEV_ECHO = "1";
revalidated.length = 0;
const swOn = await (await settings.PATCH(req("PATCH", { emailConfirm: true }))).json();
check("email switch: on when a code can be delivered", [swOn.emailConfirm.on, swOn.released, await getSetting("email_confirm")], [true, 0, "1"]);
check("email switch: the page cache is left alone (only game flips bust it)", revalidated, []);
check("email switch: GET reads it back with the accounts waiting", [(await (await settings.GET()).json()).emailConfirm.on, (await (await settings.GET()).json()).emailConfirm.waiting], [true, 3]);
check("email switch: a game flip still works beside it", (await (await settings.PATCH(req("PATCH", { games: { lorcana: true }, emailConfirm: true }))).json()).games.lorcana, true);
await settings.PATCH(req("PATCH", { games: { lorcana: false } }));

check("verify-email: unknown user → 404", await status(verifyEmail.PATCH(req("PATCH"), ctx("nope"))), 404);
const savedAdmin = testCookies.get(ADMIN_COOKIE);
testCookies.delete(ADMIN_COOKIE);
check("verify-email without the panel cookie → 403", await status(verifyEmail.PATCH(req("PATCH"), ctx(waiting.id))), 403);
testCookies.set(ADMIN_COOKIE, savedAdmin);
const mark = await verifyEmail.PATCH(req("PATCH"), ctx(waiting.id));
const markBody = await mark.json();
const waitingRow = await findUserById(waiting.id);
check("verify-email: Mark Confirmed lets the account in and stamps it proven", [mark.status, markBody.changed, markBody.user.mustConfirmEmail, waitingRow.emailPending, typeof waitingRow.emailVerifiedAt], [200, true, false, false, "number"]);
check("verify-email: marking again is a no-op", (await (await verifyEmail.PATCH(req("PATCH"), ctx(waiting.id))).json()).changed, false);

const swOff = await (await settings.PATCH(req("PATCH", { emailConfirm: false }))).json();
check("email switch: off writes 0 and lets everyone waiting straight in", [swOff.emailConfirm.on, swOff.released, await getSetting("email_confirm")], [false, 2, "0"]);
check("email switch: those accounts are open now, and not stamped as verified", [
  (await findUserById(waiting2.id)).emailPending, (await findUserById(waiting3.id)).emailPending, (await findUserById(waiting2.id)).emailVerifiedAt,
], [false, false, null]);
check("email switch: off again releases nobody", (await (await settings.PATCH(req("PATCH", { emailConfirm: false }))).json()).released, 0);
delete process.env.EMAIL_CONFIRM_DEV_ECHO;

// --- expired cookie ----------------------------------------------------------
testCookies.set(ADMIN_COOKIE, `${Date.now() - 1000}.deadbeef`);
check("expired/forged cookie → 403", await status(settings.GET()), 403);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
