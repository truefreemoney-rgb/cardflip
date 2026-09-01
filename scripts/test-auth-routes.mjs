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
check("signup: password floor", (await signup.POST(post({ name: "A", email: "a@b.co", password: "12345" }))).status, 400);

const created = await signup.POST(post({ name: "  Sam  ", email: "  Sam@Example.COM ", password: "hunter22" }));
check("signup: created", created.status, 201);
const createdBody = await created.json();
check("signup: normalised public user", [createdBody.user.name, createdBody.user.email], ["Sam", "sam@example.com"]);
check("signup: no hash in payload", "passwordHash" in createdBody.user, false);
const signupToken = sessionCookie(created);
check("signup: session cookie is live", Boolean(signupToken && await getSessionUserId(signupToken)));
check("signup: duplicate email → 409", (await signup.POST(post({ name: "B", email: "SAM@example.com", password: "123456" }))).status, 409);

// --- login ------------------------------------------------------------------
const unknown = await login.POST(post({ email: "ghost@example.com", password: "hunter22" }));
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

// --- brute-force limiter ----------------------------------------------------
const attackerIp = "203.0.113.9";
let statuses = [];
for (let i = 0; i < 21; i++) {
  statuses.push((await login.POST(post({ email: "ghost@example.com", password: "guess" }, attackerIp))).status);
}
check("login: 20 tries allowed, 21st is 429", [statuses.filter((s) => s === 401).length, statuses[20]], [20, 429]);
check("login: other IPs unaffected", (await login.POST(post({ email: "sam@example.com", password: "hunter22" }))).status, 200);

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

console.log(failures === 0 ? "\nAll auth-route checks passed" : `\n${failures} auth-route check(s) failed`);
// No process.exit(): it would skip the beforeExit hook that closes the libsql
// client, and on Windows that open handle asserts at exit (see lib/db.ts).
process.exitCode = failures === 0 ? 0 : 1;
