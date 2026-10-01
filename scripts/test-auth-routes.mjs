/**
 * Auth API routes — the login / signup / forgot / reset handlers called as
 * plain functions (they take a standard Request and return a NextResponse).
 * Run: npm run test:authroutes
 *
 * Pins: signup validation + 409 on duplicate + session cookie on success;
 * login's single "incorrect email or password" message for unknown email
 * AND wrong password (no account enumeration), the "admin" shorthand, the
 * TOTP challenge flow (required → wrong code → good code) with the admin
 * bypass; the per-IP brute-force limiter tripping at 21 attempts; forgot's
 * 503 when mail is off and its unconditional 200 when on (a reset row for
 * real accounts only — the response itself must not leak which); reset's
 * GET validity probe, password floor, one-time consume, and sign-in after.
 *
 * Same throwaway-db trick as test-auth.mjs: chdir to a temp dir before any
 * import so `data/cardflip.db` lands there. Every request carries its own
 * fly-client-ip so tests don't eat each other's rate-limit budget.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-route-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const login = await import(at("app/api/auth/login/route.ts"));
const signup = await import(at("app/api/auth/signup/route.ts"));
const forgot = await import(at("app/api/auth/forgot/route.ts"));
const reset = await import(at("app/api/auth/reset/route.ts"));
const { SESSION_COOKIE } = await import(at("lib/server/auth.ts"));
const { getSessionUserId } = await import(at("lib/server/sessions.ts"));
const { createUser, setTotpSecret, enableTotp } = await import(at("lib/server/users.ts"));
const { generateTotpSecret, totpCode } = await import(at("lib/server/totp.ts"));
const { issueResetToken } = await import(at("lib/server/passwordReset.ts"));
const { sendLoginCode, spendLoginCode, devLastLoginCode, LOGIN_CODE_TTL_MS, LOGIN_CODE_SOURCE } = await import(at("lib/server/loginCode.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

// Each call gets a unique client IP unless a test pins one on purpose.
let ipCounter = 0;
function post(body, ip) {
  return new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": ip ?? `10.0.${++ipCounter >> 8}.${ipCounter & 255}` },
    body: JSON.stringify(body),
  });
}
const sessionCookie = (res) => res.cookies.get(SESSION_COOKIE)?.value ?? null;

// --- signup -----------------------------------------------------------------
check("signup: name required", (await signup.POST(post({ email: "a@b.co", password: "123456" }))).status, 400);
check("signup: real email required", (await signup.POST(post({ name: "A", email: "not-an-email", password: "123456" }))).status, 400);
// 09-30: "a@x.com,b@y.com" passed the old check and the mailer sent the welcome mail to every address in it.
for (const many of ["a@x.com,b@y.com", "a@x.com;b@y.com", "A <a@x.com>", "\"a\"@x.com"]) {
  check(`signup: one address only (${many})`, (await signup.POST(post({ name: "A", email: many, password: "123456" }))).status, 400);
}
check("signup: password floor", (await signup.POST(post({ name: "A", email: "a@b.co", password: "12345" }))).status, 400);
check("signup: name capped at 80", (await signup.POST(post({ name: "N".repeat(81), email: "a@b.co", password: "123456" }))).status, 400);

const created = await signup.POST(post({ name: "  Sam  ", email: "  Sam@Example.COM ", password: "hunter22" }));
check("signup: created", created.status, 201);
const createdBody = await created.json();
check("signup: normalised public user", [createdBody.user.name, createdBody.user.email], ["Sam", "sam@example.com"]);
check("signup: no hash in payload", "passwordHash" in createdBody.user, false);
const signupToken = sessionCookie(created);
check("signup: session cookie is live", Boolean(signupToken && await getSessionUserId(signupToken)));
check("signup: duplicate email → 409", (await signup.POST(post({ name: "B", email: "SAM@example.com", password: "123456" }))).status, 409);

// --- one account per IP / device, no throwaway inboxes (Chris 09-29) ------------
check("signup: mailinator refused", (await signup.POST(post({ name: "P", email: "probex@mailinator.com", password: "123456" }))).status, 400);
check("signup: throwaway subdomain refused", (await signup.POST(post({ name: "P", email: "p@x.yopmail.com", password: "123456" }))).status, 400);
check("signup: gmail allowed", (await signup.POST(post({ name: "G", email: "someone@gmail.com", password: "123456" }))).status, 201);
const firstOnIp = await signup.POST(post({ name: "One", email: "one@example.com", password: "123456" }, "203.0.113.7"));
check("signup: first on an IP → 201", firstOnIp.status, 201);
const device = firstOnIp.cookies.get("cf_dev")?.value;
check("signup: sets the device cookie", Boolean(device));
check("signup: second on the same IP still → 201", (await signup.POST(post({ name: "Two", email: "two@example.com", password: "123456" }, "203.0.113.7"))).status, 201);
const sameDevice = post({ name: "Three", email: "three@example.com", password: "123456" }, "198.51.100.9");
sameDevice.headers.set("cookie", `cf_dev=${device}`);
check("signup: same device on a new IP still → 201", (await signup.POST(sameDevice)).status, 201);
const trialUsed = async (email) => (await db.prepare("SELECT trial_scans_used AS n FROM users WHERE email = ?").get(email))?.n;
check("signup: first on the IP keeps the free trial", await trialUsed("one@example.com"), 0);
check("signup: repeat IP starts with the trial spent", await trialUsed("two@example.com"), 5);
check("signup: repeat device starts with the trial spent", await trialUsed("three@example.com"), 5);
await signup.POST(post({ name: "L1", email: "l1@example.com", password: "123456" }, "127.0.0.1"));
await signup.POST(post({ name: "L2", email: "l2@example.com", password: "123456" }, "127.0.0.1"));
check("signup: loopback (e2e in CI) never counts as a repeat", await trialUsed("l2@example.com"), 0);
const fromCanada = post({ name: "C", email: "canada@example.com", password: "123456" });
fromCanada.headers.set("x-vercel-ip-country", "CA");
await signup.POST(fromCanada);
check(
  "signup: stores Vercel's country",
  (await db.prepare("SELECT s.country FROM signup_log s JOIN users u ON u.id = s.user_id WHERE u.email = 'canada@example.com'").get())?.country,
  "CA",
);

// --- signup attribution (lib/attribution.ts, 09-30) --------------------------------
const touchOf = async (email) =>
  db.prepare("SELECT s.src, s.medium, s.campaign, s.landing, s.ref_host FROM signup_log s JOIN users u ON u.id = s.user_id WHERE u.email = ?").get(email);
const tagged = await signup.POST(post({ name: "T", email: "tagged@example.com", password: "123456", touch: { s: "bluesky", m: "social", c: "pokemon-set-0930", refHost: "", landing: "/", t: Date.now() } }));
check("attribution: signup with a touch → 201", tagged.status, 201);
check("attribution: the touch lands on the signup_log row", { ...(await touchOf("tagged@example.com")) }, { src: "bluesky", medium: "social", campaign: "pokemon-set-0930", landing: "/", ref_host: "" });
const messy = await signup.POST(post({ name: "M", email: "messy@example.com", password: "123456", touch: { s: " BlueSky ", m: "Social!!", c: "Pokemon Set 0930<script>", refHost: "L.Facebook.com/x", landing: "/cards/pokemon?utm=1#top", t: 1 } }));
check("attribution: messy fields are sanitized, not refused", [messy.status, { ...(await touchOf("messy@example.com")) }], [201, { src: "bluesky", medium: "social", campaign: "pokemonset0930script", landing: "/cards/pokemon", ref_host: "l.facebook.comx" }]);
const other = await signup.POST(post({ name: "O", email: "other@example.com", password: "123456", touch: { s: "other:news.example.org", m: "", c: "", refHost: "news.example.org", landing: "/pricing", t: Date.now() } }));
check("attribution: an outside referrer is kept as other:<host>", [other.status, (await touchOf("other@example.com")).src], [201, "other:news.example.org"]);
let n = 0;
for (const bad of ["nope", 5, [], {}, { s: "evil" }, { s: 5 }, { s: "x".repeat(500) }, null]) {
  const email = `bad${++n}@example.com`;
  const res = await signup.POST(post({ name: "B", email, password: "123456", touch: bad }));
  check(`attribution: malformed touch dropped, signup unaffected (${JSON.stringify(bad)?.slice(0, 24)})`, [res.status, (await touchOf(email)).src], [201, null]);
}
const none = await signup.POST(post({ name: "N", email: "notouch@example.com", password: "123456" }));
check("attribution: no touch at all is an ordinary signup", [none.status, (await touchOf("notouch@example.com")).src], [201, null]);
// A database that never got the new columns must not cost a signup: drop one, sign up with a touch, put it back.
await db.prepare("ALTER TABLE signup_log DROP COLUMN landing").run();
const realWarn = console.warn;
console.warn = () => {};
const columnless = await signup.POST(post({ name: "Z", email: "columnless@example.com", password: "123456", touch: { s: "x", m: "social", c: "a", refHost: "", landing: "/", t: Date.now() } }));
console.warn = realWarn;
check("attribution: a missing column never fails the signup (the guard row is still written)", [columnless.status, Number((await db.prepare("SELECT COUNT(*) AS n FROM signup_log s JOIN users u ON u.id = s.user_id WHERE u.email = 'columnless@example.com'").get()).n)], [201, 1]);
await db.prepare("ALTER TABLE signup_log ADD COLUMN landing TEXT").run();

// --- login ------------------------------------------------------------------
const unknown =await login.POST(post({ email: "ghost@example.com", password: "hunter22" }));
const wrongPw = await login.POST(post({ email: "sam@example.com", password: "wrong-pw" }));
check("login: unknown email → 401", unknown.status, 401);
check("login: wrong password → 401", wrongPw.status, 401);
check("login: identical message either way (no enumeration)", (await unknown.json()).error, (await wrongPw.json()).error);

const good = await login.POST(post({ email: " SAM@example.com ", password: "hunter22" }));
check("login: success", good.status, 200);
check("login: public user returned", (await good.json()).user.email, "sam@example.com");
const loginToken = sessionCookie(good);
check("login: session cookie is live", Boolean(loginToken && await getSessionUserId(loginToken)));
check("login: cookie is httpOnly", good.cookies.get(SESSION_COOKIE)?.httpOnly, true);

const admin = await createUser("Ops", "admin@cardflip.dev", "adminpass", "admin");
check("login: bare 'admin' hits the admin account", (await (await login.POST(post({ email: "admin", password: "adminpass" }))).json()).user.email, "admin@cardflip.dev");
process.env.VERCEL_ENV = "production";
check("login: …but never on the live site (10-01 sweep)", (await login.POST(post({ email: "admin", password: "adminpass" }))).status, 401);
delete process.env.VERCEL_ENV;

// --- login + TOTP -----------------------------------------------------------
const totpUser = await createUser("Two Step", "totp@example.com", "hunter22");
const secret = generateTotpSecret();
await setTotpSecret(totpUser.id, secret);
check("login: abandoned totp setup doesn't challenge", (await login.POST(post({ email: "totp@example.com", password: "hunter22" }))).status, 200);
await enableTotp(totpUser.id);
const challenged = await login.POST(post({ email: "totp@example.com", password: "hunter22" }));
check("login: totp challenge issued", [challenged.status, (await challenged.json()).totpRequired], [401, true]);
check("login: wrong code refused", (await login.POST(post({ email: "totp@example.com", password: "hunter22", code: "000000" }))).status, 401);
check("login: good code signs in", (await login.POST(post({ email: "totp@example.com", password: "hunter22", code: totpCode(secret, Date.now()) }))).status, 200);
await setTotpSecret(admin.id, secret);
await enableTotp(admin.id);
check("login: admins skip totp", (await login.POST(post({ email: "admin", password: "adminpass" }))).status, 200);

// --- login + emailed code (admin accounts, live site only; Chris 09-30) -------
const boss = await createUser("Boss", "boss@example.com", "bosspass", "admin");
const bossLogin = (extra = {}) => login.POST(post({ email: "boss@example.com", password: "bosspass", ...extra }));
check("login code: off the live site an admin's password is enough", (await bossLogin()).status, 200);
process.env.VERCEL_ENV = "production";
const noMail = await bossLogin();
check("login code: no way to mail it → 503 and no session", [noMail.status, sessionCookie(noMail)], [503, null]);
check("login code: …reported to the Errors page", (await db.prepare("SELECT COUNT(*) AS n FROM error_events WHERE source = ?").get(LOGIN_CODE_SOURCE)).n, 1);
check("login code: …and no half-made code is left behind", (await db.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE user_id = ?").get(boss.id)).n, 0);
process.env.EMAIL_CONFIRM_DEV_ECHO = "1";
const asked = await bossLogin();
const askedBody = await asked.json();
check("login code: the password alone gets a code mailed, not a session", [asked.status, askedBody.totpRequired, askedBody.emailCode, sessionCookie(asked)], [401, true, true, null]);
check("login code: the answer shows the inbox masked", [askedBody.error.includes("b***@example.com"), askedBody.error.includes("boss@")], [true, false]);
const code1 = devLastLoginCode("boss@example.com");
check("login code: six digits", /^\d{6}$/.test(code1 ?? ""), true);
const wrongPw2 = await (await login.POST(post({ email: "boss@example.com", password: "nope", code: code1 }))).json();
check("login code: a wrong password never reaches the code step", [wrongPw2.error, wrongPw2.totpRequired], ["Incorrect email or password.", undefined]);
const wrongCode = await bossLogin({ code: code1 === "000000" ? "000001" : "000000" });
check("login code: wrong code refused, still asking by email", [wrongCode.status, (await wrongCode.json()).emailCode, sessionCookie(wrongCode)], [401, true, null]);
await bossLogin();
check("login code: asking again inside a minute mails nothing new", devLastLoginCode("boss@example.com"), code1);
const codeOk = await bossLogin({ code: code1 });
check("login code: the right code signs in", [codeOk.status, Boolean(sessionCookie(codeOk))], [200, true]);
check("login code: a code works once", (await bossLogin({ code: code1 })).status, 401);
delete process.env.EMAIL_CONFIRM_DEV_ECHO;
check("login code: a normal account is never asked", (await login.POST(post({ email: "sam@example.com", password: "hunter22" }))).status, 200);
delete process.env.VERCEL_ENV;

// The code itself (lib): expiry, the try cap, a resend replaces it, a failed mail leaves nothing.
{
  const u = await createUser("Lib", "lib@example.com", "libpass1", "admin");
  let mailed = [];
  const mail = async (to, code) => { mailed.push([to, code]); };
  const t0 = Date.now();
  check("login code lib: sent", [await sendLoginCode(u, t0, mail), mailed.length, mailed[0]?.[0]], ["sent", 1, "lib@example.com"]);
  check("login code lib: inside a minute → waiting, no second mail", [await sendLoginCode(u, t0 + 59_000, mail), mailed.length], ["waiting", 1]);
  check("login code lib: expired after 10 minutes", await spendLoginCode(u.id, mailed[0][1], t0 + LOGIN_CODE_TTL_MS + 1), false);
  check("login code lib: '482 913' style input is read as digits", await spendLoginCode(u.id, `${mailed[0][1].slice(0, 3)} ${mailed[0][1].slice(3)}`, t0 + 1000), true);
  check("login code lib: used once", await spendLoginCode(u.id, mailed[0][1], t0 + 2000), false);
  await sendLoginCode(u, t0 + 5000, mail);
  await sendLoginCode(u, t0 + 70_000, mail);
  check("login code lib: after a minute a resend mails a new code", mailed.length, 3);
  if (mailed[1][1] !== mailed[2][1]) check("login code lib: the replaced code is dead", await spendLoginCode(u.id, mailed[1][1], t0 + 71_000), false);
  check("login code lib: the newest code works", await spendLoginCode(u.id, mailed[2][1], t0 + 72_000), true);
  await sendLoginCode(u, t0 + 200_000, mail);
  const last = mailed[3][1];
  const bad = last === "111111" ? "222222" : "111111";
  for (let i = 0; i < 5; i++) await spendLoginCode(u.id, bad, t0 + 201_000);
  check("login code lib: five wrong tries burn the code", await spendLoginCode(u.id, last, t0 + 202_000), false);
  check("login code lib: a mail that throws → failed, row gone", [await sendLoginCode(u, t0 + 900_000, async () => { throw new Error("smtp down"); }), (await db.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE user_id = ?").get(u.id)).n], ["failed", 0]);
}

// --- brute-force limiter ----------------------------------------------------
const attackerIp = "203.0.113.9";
let statuses = [];
// Per IP: a different email each try, so only the IP counter is in play.
for (let i = 0; i < 21; i++) {
  statuses.push((await login.POST(post({ email: `ghost${i}@example.com`, password: "guess" }, attackerIp))).status);
}
check("login: 20 tries per IP allowed, 21st is 429", [statuses.filter((s) => s === 401).length, statuses[20]], [20, 429]);
check("login: other IPs unaffected", (await login.POST(post({ email: "sam@example.com", password: "hunter22" }))).status, 200);
// Per account: one email from a fresh IP every try — still locks at 10 (09-10).
statuses = [];
for (let i = 0; i < 11; i++) {
  statuses.push((await login.POST(post({ email: "Target@example.com", password: "guess" }, `198.51.100.${i + 1}`))).status);
}
check("login: 10 tries per account allowed, 11th is 429 across IPs", [statuses.filter((s) => s === 401).length, statuses[10]], [10, 429]);
check("login: the lock is per account, case-insensitive", (await login.POST(post({ email: "target@example.com", password: "guess" }, "198.51.100.50"))).status, 429);
check("login: other accounts unaffected", (await login.POST(post({ email: "sam@example.com", password: "hunter22" }, "198.51.100.51"))).status, 200);

// --- forgot -----------------------------------------------------------------
for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];
check("forgot: 503 when mail is off", (await forgot.POST(post({ email: "sam@example.com" }))).status, 503);

// Configure mail against a dead local port: the route must still answer 200
// for a real account (send failure is logged, never surfaced) — same body an
// unknown address gets.
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", SMTP_USER: "x@y.z", SMTP_PASS: "nope" });
const realErr = console.error;
console.error = () => {};
check("forgot: empty email → 400", (await forgot.POST(post({ email: "" }))).status, 400);
const forUnknown = await forgot.POST(post({ email: "ghost@example.com" }));
const forKnown = await forgot.POST(post({ email: "sam@example.com" }));
console.error = realErr;
check("forgot: unknown email still 200", forUnknown.status, 200);
check("forgot: identical body either way", await forUnknown.json(), await forKnown.json());
const resetCount = async (email) =>
  (await db.prepare("SELECT COUNT(*) AS n FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE u.email = ?").get(email)).n;
check("forgot: reset row minted for the real account only", [await resetCount("sam@example.com"), await resetCount("ghost@example.com")], [1, 0]);
// 10-01 sweep: one address took 10 resets per 15 minutes (~960 a day). Now 3 an hour, from any IP, real account or not.
{
  const codes = [];
  for (let i = 0; i < 4; i++) {
    codes.push((await forgot.POST(new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `5.5.5.${i}` }, body: JSON.stringify({ email: "victim@example.com" }) }))).status);
  }
  check("forgot: a 4th reset to one address within the hour is refused, whatever the IP", codes, [200, 200, 200, 429]);
}
for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];

// --- reset ------------------------------------------------------------------
const sam = { id: createdBody.user.id, email: "sam@example.com" };
const probeBad = await reset.GET(new Request("http://test/api?token=bogus"));
check("reset: GET flags a dead link", await probeBad.json(), { valid: false, email: null });
const issued = await issueResetToken(sam);
check("reset: GET names the account on a live link", await (await reset.GET(new Request(`http://test/api?token=${encodeURIComponent(issued.token)}`))).json(), { valid: true, email: "sam@example.com" });
check("reset: password floor", (await reset.POST(post({ token: issued.token, password: "12345" }))).status, 400);
check("reset: missing token → 400", (await reset.POST(post({ password: "123456" }))).status, 400);
const done = await reset.POST(post({ token: issued.token, password: "fresh-pass" }));
check("reset: success signs the seller in", [done.status, Boolean(sessionCookie(done))], [200, true]);
check("reset: earlier sessions are gone", await getSessionUserId(loginToken), null);
check("reset: link works once", (await reset.POST(post({ token: issued.token, password: "fresh-pass2" }))).status, 400);
check("reset: new password logs in", (await login.POST(post({ email: "sam@example.com", password: "fresh-pass" }))).status, 200);
check("reset: old password refused", (await login.POST(post({ email: "sam@example.com", password: "hunter22" }))).status, 401);
// 10-01 sweep: the link signed a two-step account straight in, so an inbox alone was the whole account.
{
  const t = await issueResetToken({ id: totpUser.id, email: "totp@example.com" });
  const r = await reset.POST(post({ token: t.token, password: "after-reset" }));
  check("reset: a two-step account gets its new password but no session (log in with the code)", [r.status, Boolean(sessionCookie(r)), (await r.json()).signIn], [200, false, true]);
  check("reset: …and the login then asks for the code", (await (await login.POST(post({ email: "totp@example.com", password: "after-reset" }))).json()).totpRequired, true);
}

console.log(failures === 0 ? "\nAll auth-route checks passed" : `\n${failures} auth-route check(s) failed`);
// No process.exit(): it would skip the beforeExit hook that closes the libsql
// client, and on Windows that open handle asserts at exit (see lib/db.ts).
process.exitCode = failures === 0 ? 0 : 1;
