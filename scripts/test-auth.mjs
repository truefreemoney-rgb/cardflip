/**
 * Account auth libs — password hashing, sliding sessions, one-time reset
 * links, and the user-record helpers that gate what reaches the client.
 * Run: npm run test:auth
 *
 * Pins: scrypt hash shape + verify (wrong/malformed/tampered), per-hash
 * salts; session create/lookup, expiry (lazy delete), the 1-day renewal
 * throttle on touchSession, destroy / destroy-others; reset links working
 * once, one live link per user, expiry, the consume-kills-sessions rule,
 * and the demo-account refusal; email normalisation and the public-user
 * projection never leaking password hash or TOTP secret.
 *
 * Runs against a throwaway SQLite file: the db module puts its file under
 * `<cwd>/data`, so we chdir into a temp dir BEFORE importing anything.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-auth-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const lib = (p) => new URL(`../src/lib/${p}`, import.meta.url).href;
const { hashPassword, verifyPassword } = await import(lib("server/password.ts"));
const {
  SESSION_TTL_MS,
  createSession,
  destroyOtherSessions,
  destroySession,
  getSessionUserId,
  sessionCookieOptions,
  touchSession,
} = await import(lib("server/sessions.ts"));
const {
  consumeResetToken,
  issueResetToken,
  passwordProblem,
  peekResetToken,
} = await import(lib("server/passwordReset.ts"));
const {
  DEMO_EMAIL,
  createUser,
  findUserByEmail,
  isDemoUser,
  isSubscribed,
  toPublicUser,
  totpEnabled,
} = await import(lib("server/users.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const realNow = Date.now;
let fakeNow = 1_800_000_000_000;
Date.now = () => fakeNow;
const advance = (ms) => { fakeNow += ms; };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// --- password hashing -------------------------------------------------------
const stored = hashPassword("hunter22");
check("hash shape salt:hash", /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(stored));
check("correct password verifies", verifyPassword("hunter22", stored));
check("wrong password refused", verifyPassword("hunter23", stored), false);
check("case matters", verifyPassword("Hunter22", stored), false);
check("empty refused", verifyPassword("", stored), false);
check("malformed stored refused", verifyPassword("hunter22", "no-colon-here"), false);
check("truncated hash refused", verifyPassword("hunter22", stored.slice(0, -2)), false);
check("salts differ per hash", hashPassword("hunter22") === stored, false);

// --- user records ------------------------------------------------------------
const user = await createUser("  Chris  ", "  Chris@Example.COM ", "hunter22");
check("name trimmed", user.name, "Chris");
check("email normalised", user.email, "chris@example.com");
check("lookup is case-insensitive", (await findUserByEmail("CHRIS@example.com "))?.id, user.id);
check("unknown email → null", await findUserByEmail("nobody@example.com"), null);
check("stored hash verifies", verifyPassword("hunter22", user.passwordHash));

const pub = toPublicUser({ ...user, totpSecret: "SECRET", totpEnabledAt: fakeNow });
check("public user has no hash/secret", ["passwordHash", "totpSecret"].map((k) => k in pub), [false, false]);
check("public user reports totp on", pub.totpEnabled, true);
check("abandoned totp setup counts as off", totpEnabled({ totpSecret: "SECRET", totpEnabledAt: null }), false);
check("subscribed statuses", ["active", "trialing", "past_due", "canceled", null].map((s) => isSubscribed({ subStatus: s })), [true, true, true, false, false]);
check("demo detection", [isDemoUser({ email: DEMO_EMAIL }), isDemoUser(user)], [true, false]);

// --- sessions ----------------------------------------------------------------
const s1 = await createSession(user.id);
check("expiry = now + 30d", s1.expiresAt, fakeNow + SESSION_TTL_MS);
check("token resolves to user", await getSessionUserId(s1.token), user.id);
check("unknown token → null", await getSessionUserId("not-a-token"), null);

check("young session not renewed", await touchSession(s1.token), null);
advance(2 * DAY);
const renewed = await touchSession(s1.token);
check("2-day-old session renews to fresh 30d", renewed?.expiresAt, fakeNow + SESSION_TTL_MS);
check("renewal is persisted", (await touchSession(s1.token)), null);

advance(SESSION_TTL_MS + 1);
check("expired session → null", await getSessionUserId(s1.token), null);
check("expired session was deleted (touch too)", await touchSession(s1.token), null);

const keep = await createSession(user.id);
await createSession(user.id);
await createSession(user.id);
check("destroy others keeps the caller", await destroyOtherSessions(user.id, keep.token), 2);
check("kept session still live", await getSessionUserId(keep.token), user.id);
check("destroy others with no keeper", await destroyOtherSessions(user.id, null), 1);
await destroySession(keep.token);
check("destroyed session is gone", await getSessionUserId(keep.token), null);
await destroySession(keep.token); // idempotent — a second destroy must not throw


const opts = sessionCookieOptions(fakeNow + 1000);
check("cookie: httpOnly lax /", [opts.httpOnly, opts.sameSite, opts.path], [true, "lax", "/"]);
check("cookie: not Secure outside production", opts.secure, false);
check("cookie: persistent expiry matches", opts.expires.getTime(), fakeNow + 1000);

// --- password reset links ----------------------------------------------------
const r1 = await issueResetToken(user);
check("link carries the token", r1.url.includes(encodeURIComponent(r1.token)));
check("link lives an hour", r1.expiresAt, fakeNow + HOUR);
check("peek finds the user", (await peekResetToken(r1.token))?.id, user.id);
check("peek doesn't consume", (await peekResetToken(r1.token))?.id, user.id);
check("unknown token → null", await peekResetToken("bogus"), null);

const r2 = await issueResetToken(user);
check("new link revokes the old", await peekResetToken(r1.token), null);

const live = await createSession(user.id);
const reset = await consumeResetToken(r2.token, "newpass9");
check("consume returns the user", reset?.id, user.id);
check("new password set", verifyPassword("newpass9", (await findUserByEmail(user.email)).passwordHash));
check("old password gone", verifyPassword("hunter22", (await findUserByEmail(user.email)).passwordHash), false);
check("consume signs out every session", await getSessionUserId(live.token), null);
check("link works once", await consumeResetToken(r2.token, "again0"), null);

const r3 = await issueResetToken(user);
advance(HOUR + 1);
check("expired link → null", await peekResetToken(r3.token), null);

const demo = await createUser("Demo", DEMO_EMAIL, "demo-pass");
check("demo account is never resettable", await issueResetToken(demo).then(() => "issued", (e) => e.message), "The demo account has no password to reset");

check("password floor", [passwordProblem("12345"), passwordProblem("123456"), passwordProblem("x".repeat(201))],
  ["Password must be at least 6 characters.", null, "That password is too long."]);

Date.now = realNow;
console.log(failures === 0 ? "\nAll auth checks passed" : `\n${failures} auth check(s) failed`);
// No process.exit(): it would skip the beforeExit hook that closes the libsql
// client, and on Windows that open handle asserts at exit (see lib/db.ts).
process.exitCode = failures === 0 ? 0 : 1;
