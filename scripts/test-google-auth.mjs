/**
 * "Continue with Google" — lib/googleAuth.ts (pure) and the start / callback routes with Google's
 * token endpoint stubbed. Run: npm run test:google
 *
 * Pins: state cookie round trip and mismatch; id_token claim checks (iss, aud, exp, nonce,
 * email_verified, missing email); the new / link / login decision (admin and two-step accounts are
 * never opened by Google alone); safe `next`; no-password hash never verifies; start redirect URL;
 * callback end to end: new account (trial, welcome redirect, email confirmed, device cookie, no
 * password), second sign-in = same account, link to an existing email, never-proven inbox loses its
 * old password, pending signup is let through, admin refused, bad state / denied consent / bad aud.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "VERCEL"]) delete process.env[k];
process.env.EBAY_TOKEN_KEY = "test-signing-key";
process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-google-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const g = await import(at("lib/googleAuth.ts"));
const start = await import(at("app/api/auth/google/start/route.ts"));
const callback = await import(at("app/api/auth/google/callback/route.ts"));
const login = await import(at("app/api/auth/login/route.ts"));
const { createUser, findUserByEmail, findUserByGoogleSub, setTotpSecret, enableTotp } = await import(at("lib/server/users.ts"));
const { verifyPassword, hashPassword } = await import(at("lib/server/password.ts"));
const { getSessionUserId, createSession } = await import(at("lib/server/sessions.ts"));
const { SESSION_COOKIE } = await import(at("lib/server/auth.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const CID = process.env.GOOGLE_CLIENT_ID;
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const goodClaims = (over = {}) => ({
  iss: "https://accounts.google.com",
  aud: CID,
  exp: Math.floor(NOW / 1000) + 3600,
  sub: "1234567890",
  nonce: "nonce-nonce-nonce-1",
  email: "Pat.Smith@Gmail.com",
  email_verified: true,
  given_name: "Pat",
  name: "Pat Smith",
  ...over,
});
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

// --- pure: state --------------------------------------------------------------
const st = { s: "s".repeat(24), n: "n".repeat(24), mode: "signup", next: "/app/inventory", ref: "abcd1234", touch: null, fromScan: true };
const back = g.decodeState(g.encodeState(st));
check("state: round trip keeps mode, next, fromScan", [back?.mode, back?.next, back?.fromScan], ["signup", "/app/inventory", true]);
check("state: invite code is upper-cased", back?.ref, "ABCD1234");
check("state: matches the returned value", g.stateMatches(back, st.s), true);
check("state: wrong value refused", g.stateMatches(back, "x".repeat(24)), false);
check("state: wrong length refused", g.stateMatches(back, st.s.slice(1)), false);
check("state: empty / missing refused", [g.stateMatches(back, ""), g.stateMatches(null, st.s), g.stateMatches(back, null)], [false, false, false]);
check("state: garbage cookie decodes to null", [g.decodeState("%%%"), g.decodeState(""), g.decodeState(undefined), g.decodeState(Buffer.from("{}").toString("base64url"))], [null, null, null, null]);
check("state: short state refused", g.decodeState(g.encodeState({ ...st, s: "short" })), null);
check("state: bad mode refused", g.decodeState(g.encodeState({ ...st, mode: "admin" })), null);

check("next: in-app path kept", g.safeNext("/app/inventory?x=1"), "/app/inventory?x=1");
for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "/a b", "evil", "", null, "/login", "/signup", "/api/auth/logout"]) {
  check(`next: ${JSON.stringify(bad)} refused`, g.safeNext(bad), null);
}

// --- pure: claims ---------------------------------------------------------------
const opts = { clientId: CID, nonce: "nonce-nonce-nonce-1", now: NOW };
const ok = g.validateClaims(goodClaims(), opts);
check("claims: good token accepted, email lower-cased, first name", [ok.ok, ok.email, ok.name, ok.sub], [true, "pat.smith@gmail.com", "Pat", "1234567890"]);
check("claims: accounts.google.com (no scheme) also fine", g.validateClaims(goodClaims({ iss: "accounts.google.com" }), opts).ok, true);
check("claims: wrong issuer", g.validateClaims(goodClaims({ iss: "https://evil.example" }), opts), { ok: false, reason: "iss" });
check("claims: wrong audience", g.validateClaims(goodClaims({ aud: "other" }), opts), { ok: false, reason: "aud" });
check("claims: audience list with another id refused", g.validateClaims(goodClaims({ aud: [CID, "other"] }), opts).ok, false);
check("claims: expired", g.validateClaims(goodClaims({ exp: Math.floor(NOW / 1000) - 1 }), opts), { ok: false, reason: "expired" });
check("claims: no exp", g.validateClaims(goodClaims({ exp: undefined }), opts).ok, false);
check("claims: nonce mismatch", g.validateClaims(goodClaims({ nonce: "other" }), opts), { ok: false, reason: "nonce" });
check("claims: nonce missing", g.validateClaims(goodClaims({ nonce: undefined }), opts).ok, false);
check("claims: unverified email", g.validateClaims(goodClaims({ email_verified: false }), opts), { ok: false, reason: "unverified" });
check("claims: email_verified as a string is not true", g.validateClaims(goodClaims({ email_verified: "true" }), opts).ok, false);
check("claims: no email", g.validateClaims(goodClaims({ email: undefined }), opts), { ok: false, reason: "no_email" });
check("claims: no subject", g.validateClaims(goodClaims({ sub: undefined }), opts).ok, false);
check("claims: null payload", g.validateClaims(null, opts).ok, false);
check("claims: name falls back to full name's first word, then the email's local part",
  [g.validateClaims(goodClaims({ given_name: undefined }), opts).name, g.validateClaims(goodClaims({ given_name: undefined, name: undefined }), opts).name],
  ["Pat", "pat.smith"]);
check("claims: name capped at 80", g.validateClaims(goodClaims({ given_name: "N".repeat(200) }), opts).name.length, 80);
check("jwt: payload decodes", g.decodeJwtPayload(jwt({ a: 1 })), { a: 1 });
check("jwt: junk decodes to null", [g.decodeJwtPayload("abc"), g.decodeJwtPayload("a.b.c")], [null, null]);

// --- pure: account decision -------------------------------------------------------
const plain = { hasSecondStep: false };
check("decide: unknown identity → create", g.decideAccount({ bySub: null, byEmail: null }), "create");
check("decide: known google id → login", g.decideAccount({ bySub: plain, byEmail: null }), "login");
check("decide: same email, not tied → link", g.decideAccount({ bySub: null, byEmail: { hasSecondStep: false, googleSub: null } }), "link");
check("decide: same email already tied to another google id → refused", g.decideAccount({ bySub: null, byEmail: { hasSecondStep: false, googleSub: "other" } }), "refuse-stronger-account");
check("decide: admin / two-step by email → refused", g.decideAccount({ bySub: null, byEmail: { hasSecondStep: true, googleSub: null } }), "refuse-stronger-account");
check("decide: admin / two-step by google id → refused", g.decideAccount({ bySub: { hasSecondStep: true }, byEmail: null }), "refuse-stronger-account");
check("password: no-password marker never verifies", [verifyPassword("", g.NO_PASSWORD), verifyPassword(g.NO_PASSWORD, g.NO_PASSWORD), verifyPassword("x", g.NO_PASSWORD)], [false, false, false]);
check("password: hasPassword", [g.hasPassword(g.NO_PASSWORD), g.hasPassword(hashPassword("abcdefgh"))], [false, true]);

// --- routes -----------------------------------------------------------------------
let ipN = 0;
const ipHeader = () => ({ "fly-client-ip": `10.9.${++ipN >> 8}.${ipN & 255}` });
let tokenReply = null;
const realFetch = globalThis.fetch;
let tokenCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
    tokenCalls++;
    const body = String(init?.body ?? "");
    if (!body.includes("grant_type=authorization_code") || !body.includes("client_secret=secret")) return new Response("{}", { status: 400 });
    return tokenReply ? new Response(JSON.stringify({ id_token: tokenReply }), { status: 200 }) : new Response("{}", { status: 400 });
  }
  return realFetch(url, init);
};

/** start → remember the state cookie it set → hit the callback the way Google would. */
async function roundTrip({ mode = "signup", next, claims = {}, tamperState = false, error, cookieHeader = "", ref, touch } = {}) {
  testCookies.clear();
  const q = new URLSearchParams({ mode });
  if (next) q.set("next", next);
  if (ref) q.set("ref", ref);
  if (touch) q.set("touch", JSON.stringify(touch));
  const s = await start.GET(new Request(`https://cardflip.io/api/auth/google/start?${q}`, { headers: ipHeader() }));
  const loc = new URL(s.headers.get("location"));
  const cookie = s.cookies.get("cf_gstate");
  if (cookie) testCookies.set("cf_gstate", cookie.value);
  const state = loc.searchParams.get("state");
  const nonce = loc.searchParams.get("nonce");
  tokenReply = jwt(goodClaims({ nonce, exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  const params = new URLSearchParams(error ? { error, state } : { code: "authcode", state: tamperState ? "x".repeat(32) : state });
  const res = await callback.GET(
    new Request(`https://cardflip.io/api/auth/google/callback?${params}`, { headers: { ...ipHeader(), cookie: cookieHeader } }),
  );
  return { s, loc, res, to: new URL(res.headers.get("location")) };
}

const s0 = await start.GET(new Request("https://cardflip.io/api/auth/google/start?mode=login&next=/app/inventory", { headers: ipHeader() }));
const l0 = new URL(s0.headers.get("location"));
check("start: goes to Google's authorize URL", l0.origin + l0.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
check("start: client id, scope, response type, prompt", [l0.searchParams.get("client_id"), l0.searchParams.get("scope"), l0.searchParams.get("response_type"), l0.searchParams.get("prompt")], [CID, "openid email profile", "code", "select_account"]);
check("start: redirect uri is the canonical callback", l0.searchParams.get("redirect_uri"), "https://cardflip.io/api/auth/google/callback");
check("start: random state and nonce", [l0.searchParams.get("state").length >= 24, l0.searchParams.get("nonce").length >= 24, l0.searchParams.get("state") !== l0.searchParams.get("nonce")], [true, true, true]);
const sc = s0.cookies.get("cf_gstate");
check("start: state cookie is httpOnly, lax, short-lived", [sc?.httpOnly, sc?.sameSite, sc?.maxAge], [true, "lax", 600]);
const local = await start.GET(new Request("http://localhost:3000/api/auth/google/start?mode=signup", { headers: ipHeader() }));
check("start: localhost uses its own origin", new URL(local.headers.get("location")).searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/google/callback");
const prev = await start.GET(new Request("https://cardflip-git-x-chris.vercel.app/api/auth/google/start?mode=signup", { headers: ipHeader() }));
check("start: a vercel preview uses its own origin", new URL(prev.headers.get("location")).searchParams.get("redirect_uri"), "https://cardflip-git-x-chris.vercel.app/api/auth/google/callback");
const www = await start.GET(new Request("https://www.cardflip.io/api/auth/google/start?mode=signup", { headers: ipHeader() }));
check("start: an alias host still registers the canonical uri", new URL(www.headers.get("location")).searchParams.get("redirect_uri"), "https://cardflip.io/api/auth/google/callback");

// New account.
const touch = { s: "tiktok", m: "social", c: "post1", refHost: "", landing: "/", t: NOW };
const r1 = await roundTrip({ mode: "signup", claims: {}, touch });
check("callback: new account lands on the welcome step", r1.to.pathname + r1.to.search, "/signup?step=welcome&google=new");
const u1 = await findUserByEmail("pat.smith@gmail.com");
check("callback: account made with the first name, Google id stored", [u1?.name, u1?.googleSub], ["Pat", "1234567890"]);
check("callback: no password, email already confirmed, nothing pending", [g.hasPassword(u1.passwordHash), Boolean(u1.emailVerifiedAt), u1.emailPending], [false, true, false]);
check("callback: free trial untouched on a first signup", u1.trialScansUsed, 0);
check("callback: session cookie is live", (await getSessionUserId(r1.res.cookies.get(SESSION_COOKIE)?.value)) === u1.id);
check("callback: device cookie set, state cookie cleared", [Boolean(r1.res.cookies.get("cf_dev")?.value), r1.res.cookies.get("cf_gstate")?.value], [true, ""]);
const log1 = await db.prepare("SELECT src, medium, campaign, device_id FROM signup_log WHERE user_id = ?").get(u1.id);
check("callback: signup attribution recorded like the email form", [log1?.src, log1?.medium, log1?.campaign, Boolean(log1?.device_id)], ["tiktok", "social", "post1", true]);

// Same Google account again = log in, never a second account or a signup.
const r2 = await roundTrip({ mode: "login", next: "/app/inventory" });
check("callback: returning Google user goes to next", r2.to.pathname, "/app/inventory");
check("callback: ...as the same account, no second signup row", [
  (await findUserByGoogleSub("1234567890"))?.id === u1.id,
  (await db.prepare("SELECT COUNT(*) AS n FROM signup_log WHERE user_id = ?").get(u1.id)).n,
], [true, 1]);
check("callback: login without next goes to /app", (await roundTrip({ mode: "login" })).to.pathname, "/app");
check("callback: an unsafe next is dropped", (await roundTrip({ mode: "login", next: "//evil.com" })).to.pathname, "/app");

// Email/password login on a Google-only account says so.
const loginRes = await login.POST(new Request("http://t/api/auth/login", { method: "POST", headers: { "content-type": "application/json", ...ipHeader() }, body: JSON.stringify({ email: "pat.smith@gmail.com", password: "whatever1" }) }));
const loginBody = await loginRes.json();
check("login: password sign-in on a Google account → 401 that names Google", [loginRes.status, /Google/.test(loginBody.error)], [401, true]);

// Link: an existing password account with the same email.
const old = await createUser("Old", "linkme@example.com", "oldpass99");
await db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(NOW, old.id);
const r3 = await roundTrip({ mode: "login", claims: { sub: "sub-link", email: "LinkMe@Example.com" } });
const old2 = await findUserByEmail("linkme@example.com");
check("callback: existing email is linked, not duplicated", [r3.to.pathname, old2.id === old.id, old2.googleSub], ["/app", true, "sub-link"]);
check("callback: a proven account keeps its password", verifyPassword("oldpass99", old2.passwordHash), true);

// Link onto a never-proven inbox: someone may have typed a password for another person's address.
const squat = await createUser("Squatter", "victim@example.com", "squatpass1");
const squatSession = await createSession(squat.id);
const r4 = await roundTrip({ mode: "login", claims: { sub: "sub-victim", email: "victim@example.com" } });
const squat2 = await findUserByEmail("victim@example.com");
check("callback: never-proven inbox is linked and the old password is gone", [r4.to.pathname, squat2.googleSub, verifyPassword("squatpass1", squat2.passwordHash)], ["/app", "sub-victim", false]);
check("callback: ...and its other sessions are signed out", await getSessionUserId(squatSession.token), null);

// Pending signup is let through.
const pend = await createUser("Pend", "pending@example.com", "pendpass11", "user", { emailPending: true });
await roundTrip({ mode: "login", claims: { sub: "sub-pend", email: "pending@example.com" } });
const pend2 = await findUserByEmail("pending@example.com");
check("callback: a signup waiting on its code is confirmed by Google", [pend2.emailPending, Boolean(pend2.emailVerifiedAt)], [false, true]);

// Admin / two-step accounts are not opened by Google.
const admin = await createUser("Boss", "boss@example.com", "bosspass11", "admin");
const r5 = await roundTrip({ mode: "login", claims: { sub: "sub-boss", email: "boss@example.com" } });
check("callback: admin account refused with the extra-security message", [r5.to.pathname + r5.to.search, r5.res.cookies.get(SESSION_COOKIE)?.value ?? null], ["/login?google_error=2", null]);
check("callback: ...and nothing was linked", (await findUserByEmail("boss@example.com")).googleSub, null);
const tw = await createUser("Two", "twostep@example.com", "twopass111");
await setTotpSecret(tw.id, "JBSWY3DPEHPK3PXP");
await enableTotp(tw.id);
const r6 = await roundTrip({ mode: "login", claims: { sub: "sub-two", email: "twostep@example.com" } });
check("callback: two-step account refused", r6.to.pathname + r6.to.search, "/login?google_error=2");

// Failures land back on the page they started from with the plain-words flag.
check("fail: tampered state → back to signup", (await roundTrip({ mode: "signup", tamperState: true })).to.pathname + "?" + "", "/signup?");
const tamper = await roundTrip({ mode: "signup", tamperState: true });
check("fail: tampered state makes no account and no session", [tamper.to.search, tamper.res.cookies.get(SESSION_COOKIE)?.value ?? null], ["?google_error=1", null]);
check("fail: denied consent → login page flag", (await roundTrip({ mode: "login", error: "access_denied" })).to.search, "?google_error=1");
check("fail: wrong audience", (await roundTrip({ mode: "signup", claims: { aud: "someone-else", sub: "sub-x", email: "x@example.com" } })).to.search, "?google_error=1");
check("fail: unverified email", (await roundTrip({ mode: "signup", claims: { email_verified: false, sub: "sub-y", email: "y@example.com" } })).to.search, "?google_error=1");
check("fail: expired token", (await roundTrip({ mode: "signup", claims: { exp: 1, sub: "sub-z", email: "z@example.com" } })).to.search, "?google_error=1");
check("fail: none of those made an account", [await findUserByEmail("x@example.com"), await findUserByEmail("y@example.com"), await findUserByEmail("z@example.com")], [null, null, null]);
check("fail: nonce from another round trip", (await roundTrip({ mode: "signup", claims: { nonce: "replayed-nonce-from-elsewhere", sub: "sub-n", email: "n@example.com" } })).to.search, "?google_error=1");
testCookies.clear();
const noCookie = await callback.GET(new Request("https://cardflip.io/api/auth/google/callback?code=c&state=abc", { headers: ipHeader() }));
check("fail: no state cookie at all → login page flag", new URL(noCookie.headers.get("location")).pathname + new URL(noCookie.headers.get("location")).search, "/login?google_error=1");
tokenReply = null;

// A second signup from the same device starts with the trial spent (anti-abuse is shared with the email form).
const dev = r1.res.cookies.get("cf_dev").value;
const r7 = await roundTrip({ mode: "signup", claims: { sub: "sub-rep", email: "second.person@example.com" }, cookieHeader: `cf_dev=${dev}` });
const rep = await findUserByEmail("second.person@example.com");
check("callback: repeat device → account made, free scans already spent", [r7.to.search, rep?.trialScansUsed], ["?step=welcome&google=new", 5]);

// Not configured: the routes refuse politely.
delete process.env.GOOGLE_CLIENT_ID;
const off = await start.GET(new Request("https://cardflip.io/api/auth/google/start?mode=signup", { headers: ipHeader() }));
check("no keys: start sends the visitor back with the error flag", new URL(off.headers.get("location")).pathname + new URL(off.headers.get("location")).search, "/signup?google_error=1");

globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
