/**
 * "Continue with X" - lib/xAuth.ts (pure) and the start / callback / finish routes with X's token and
 * profile endpoints stubbed. Run: npm run test:xauth
 *
 * Pins: PKCE challenge, state round trip and mismatch, profile parsing (missing email, bad id), the
 * login / link / create / need-email / refuse decision table, the signed pending cookie (expiry,
 * tamper), start redirect URL, callback end to end (new account with confirmed email, returning
 * login, link, never-proven inbox loses its password, admin / two-step refused, bad state), and the
 * no-email path through POST /api/auth/x/finish (pending cookie, confirmation code, existing email 409).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "VERCEL"]) delete process.env[k];
process.env.EBAY_TOKEN_KEY = "test-signing-key";
process.env.X_CLIENT_ID = "x-client-id";
process.env.X_CLIENT_SECRET = "x-secret";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-x-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const x = await import(at("lib/xAuth.ts"));
const sx = await import(at("lib/server/xAuth.ts"));
const start = await import(at("app/api/auth/x/start/route.ts"));
const callback = await import(at("app/api/auth/x/callback/route.ts"));
const finish = await import(at("app/api/auth/x/finish/route.ts"));
const { createUser, findUserByEmail, findUserByXSub, setTotpSecret, enableTotp } = await import(at("lib/server/users.ts"));
const { verifyPassword } = await import(at("lib/server/password.ts"));
const { hasPassword } = await import(at("lib/googleAuth.ts"));
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

// --- pure: PKCE + state -------------------------------------------------------
const verifier = "v".repeat(60);
check("pkce: challenge is base64url(sha256(verifier))", x.pkceChallenge(verifier), createHash("sha256").update(verifier).digest("base64url"));
check("pkce: RFC 7636 example vector", x.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");

const st = { s: "s".repeat(24), v: verifier, mode: "signup", next: "/app/inventory", ref: "abcd1234", touch: null, fromScan: true };
const back = x.decodeXState(x.encodeXState(st));
check("state: round trip keeps mode, next, fromScan, verifier", [back?.mode, back?.next, back?.fromScan, back?.v], ["signup", "/app/inventory", true, verifier]);
check("state: invite code is upper-cased", back?.ref, "ABCD1234");
check("state: matches the returned value", x.xStateMatches(back, st.s), true);
check("state: wrong value / length / empty refused", [x.xStateMatches(back, "x".repeat(24)), x.xStateMatches(back, st.s.slice(1)), x.xStateMatches(back, ""), x.xStateMatches(null, st.s)], [false, false, false, false]);
check("state: garbage decodes to null", [x.decodeXState("%%%"), x.decodeXState(""), x.decodeXState(undefined), x.decodeXState(Buffer.from("{}").toString("base64url"))], [null, null, null, null]);
check("state: short verifier refused", x.decodeXState(x.encodeXState({ ...st, v: "short" })), null);
check("state: bad mode refused", x.decodeXState(x.encodeXState({ ...st, mode: "admin" })), null);
check("state: unsafe next dropped", x.decodeXState(x.encodeXState({ ...st, next: "//evil.com" }))?.next, null);

// --- pure: profile -------------------------------------------------------------
const prof = (data) => ({ data });
const good = x.parseXProfile(prof({ id: "1234567890", name: "Pat Smith", username: "patsmith", confirmed_email: "Pat@Example.com" }));
check("profile: good body, email lower-cased", [good.ok, good.sub, good.name, good.username, good.email], [true, "1234567890", "Pat Smith", "patsmith", "pat@example.com"]);
check("profile: missing confirmed_email -> null", x.parseXProfile(prof({ id: "1", name: "A", username: "a" })).email, null);
check("profile: empty / non-string / malformed email -> null", [
  x.parseXProfile(prof({ id: "1", confirmed_email: "" })).email,
  x.parseXProfile(prof({ id: "1", confirmed_email: 5 })).email,
  x.parseXProfile(prof({ id: "1", confirmed_email: "nope" })).email,
], [null, null, null]);
check("profile: name falls back to username", x.parseXProfile(prof({ id: "1", name: " ", username: "handle" })).name, "handle");
check("profile: bad ids refused", ["abc", "", 12, null, "1 2", "9".repeat(40)].map((id) => x.parseXProfile(prof({ id })).ok), [false, false, false, false, false, false]);
check("profile: no data / junk refused", [x.parseXProfile(null).ok, x.parseXProfile({}).ok, x.parseXProfile("x").ok], [false, false, false]);

// --- pure: decision table -------------------------------------------------------
const plain = { hasSecondStep: false };
const D = x.decideXAccount;
check("decide: x id known -> login", D({ bySub: plain, hasEmail: true, byEmail: null }), "login");
check("decide: x id known, no email this time -> still login", D({ bySub: plain, hasEmail: false, byEmail: null }), "login");
check("decide: x id known with second step -> refused", D({ bySub: { hasSecondStep: true }, hasEmail: true, byEmail: null }), "refuse-stronger-account");
check("decide: same email, not tied -> link", D({ bySub: null, hasEmail: true, byEmail: { hasSecondStep: false, xSub: null } }), "link");
check("decide: same email tied to another x id -> refused", D({ bySub: null, hasEmail: true, byEmail: { hasSecondStep: false, xSub: "other" } }), "refuse-stronger-account");
check("decide: same email with second step -> refused", D({ bySub: null, hasEmail: true, byEmail: { hasSecondStep: true, xSub: null } }), "refuse-stronger-account");
check("decide: email, no account -> create", D({ bySub: null, hasEmail: true, byEmail: null }), "create");
check("decide: no email, unknown -> need-email", D({ bySub: null, hasEmail: false, byEmail: null }), "need-email");

// --- server: pending cookie ---------------------------------------------------------
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const pend = { sub: "42", name: "Pat", username: "pat", mode: "signup", next: "/app", ref: "abcd1234", touch: null, fromScan: false, iat: NOW };
const signed = sx.signXPending(pend, "k");
const okp = sx.verifyXPending(signed, "k", NOW + 60_000);
check("pending: round trip", [okp?.sub, okp?.name, okp?.ref, okp?.next], ["42", "Pat", "ABCD1234", "/app"]);
check("pending: wrong secret refused", sx.verifyXPending(signed, "other", NOW), null);
check("pending: tampered body refused", sx.verifyXPending(Buffer.from(JSON.stringify({ ...pend, sub: "43" })).toString("base64url") + "." + signed.split(".")[1], "k", NOW), null);
check("pending: tampered signature refused", sx.verifyXPending(signed.slice(0, -2) + "AA", "k", NOW), null);
check("pending: 14 min ok, 16 min refused", [!!sx.verifyXPending(signed, "k", NOW + 14 * 60_000), sx.verifyXPending(signed, "k", NOW + 16 * 60_000)], [true, null]);
check("pending: from the future refused", sx.verifyXPending(signed, "k", NOW - 5 * 60_000), null);
check("pending: junk / empty refused", [sx.verifyXPending("abc", "k", NOW), sx.verifyXPending("", "k", NOW), sx.verifyXPending(null, "k", NOW), sx.verifyXPending(signed, "", NOW)], [null, null, null, null]);

// --- routes ---------------------------------------------------------------------------
let ipN = 0;
const ipHeader = () => ({ "fly-client-ip": `10.8.${++ipN >> 8}.${ipN & 255}` });
let profileReply = null;
let tokenOk = true;
let lastTokenCall = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.x.com/2/oauth2/token")) {
    const body = String(init?.body ?? "");
    lastTokenCall = { body, auth: init?.headers?.Authorization };
    const basicOk = init?.headers?.Authorization === `Basic ${Buffer.from("x-client-id:x-secret").toString("base64")}`;
    if (!tokenOk || !basicOk || !body.includes("grant_type=authorization_code") || !body.includes("code_verifier=")) return new Response("{}", { status: 400 });
    return new Response(JSON.stringify({ access_token: "tok123", token_type: "bearer" }), { status: 200 });
  }
  if (u.startsWith("https://api.x.com/2/users/me")) {
    if (init?.headers?.Authorization !== "Bearer tok123" || !u.includes("confirmed_email")) return new Response("{}", { status: 401 });
    return profileReply ? new Response(JSON.stringify(profileReply), { status: 200 }) : new Response("{}", { status: 403 });
  }
  return realFetch(url, init);
};

/** start -> remember the state cookie it set -> hit the callback the way X would. */
async function roundTrip({ mode = "signup", next, data = {}, tamperState = false, error, cookieHeader = "", ref, touch } = {}) {
  testCookies.clear();
  const q = new URLSearchParams({ mode });
  if (next) q.set("next", next);
  if (ref) q.set("ref", ref);
  if (touch) q.set("touch", JSON.stringify(touch));
  const s = await start.GET(new Request(`https://cardflip.io/api/auth/x/start?${q}`, { headers: ipHeader() }));
  const loc = new URL(s.headers.get("location"));
  const cookie = s.cookies.get("x_oauth");
  if (cookie) testCookies.set("x_oauth", cookie.value);
  const state = loc.searchParams.get("state");
  profileReply = { data: { id: "777001", name: "Pat Smith", username: "patsmith", confirmed_email: "Pat.Smith@Gmail.com", ...data } };
  const params = new URLSearchParams(error ? { error, state } : { code: "authcode", state: tamperState ? "x".repeat(32) : state });
  const res = await callback.GET(
    new Request(`https://cardflip.io/api/auth/x/callback?${params}`, { headers: { ...ipHeader(), cookie: cookieHeader } }),
  );
  return { s, loc, res, to: new URL(res.headers.get("location")) };
}
const where = (r) => r.to.pathname + r.to.search;

const s0 = await start.GET(new Request("https://cardflip.io/api/auth/x/start?mode=login&next=/app/inventory", { headers: ipHeader() }));
const l0 = new URL(s0.headers.get("location"));
check("start: goes to X's authorize URL", l0.origin + l0.pathname, "https://x.com/i/oauth2/authorize");
check("start: client id, scope, response type", [l0.searchParams.get("client_id"), l0.searchParams.get("scope"), l0.searchParams.get("response_type")], ["x-client-id", "tweet.read users.read users.email", "code"]);
check("start: redirect uri is the canonical callback", l0.searchParams.get("redirect_uri"), "https://cardflip.io/api/auth/x/callback");
const sc = s0.cookies.get("x_oauth");
check("start: state cookie is httpOnly, lax, 10 min, scoped to /api/auth/x", [sc?.httpOnly, sc?.sameSite, sc?.maxAge, sc?.path], [true, "lax", 600, "/api/auth/x"]);
const stored = x.decodeXState(sc.value);
check("start: PKCE S256 challenge matches the stored verifier", [l0.searchParams.get("code_challenge_method"), l0.searchParams.get("code_challenge") === x.pkceChallenge(stored.v), l0.searchParams.get("state") === stored.s], ["S256", true, true]);
check("start: the verifier is never in the URL", l0.toString().includes(stored.v), false);
const local = await start.GET(new Request("http://localhost:3000/api/auth/x/start?mode=signup", { headers: ipHeader() }));
check("start: localhost uses its own origin", new URL(local.headers.get("location")).searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/x/callback");
const www = await start.GET(new Request("https://www.cardflip.io/api/auth/x/start?mode=signup", { headers: ipHeader() }));
check("start: an alias host still registers the canonical uri", new URL(www.headers.get("location")).searchParams.get("redirect_uri"), "https://cardflip.io/api/auth/x/callback");

// New account with an email X confirmed.
const touch = { s: "tiktok", m: "social", c: "post1", refHost: "", landing: "/", t: NOW };
const r1 = await roundTrip({ mode: "signup", touch });
check("callback: new account lands on the welcome step", where(r1), "/signup?step=welcome&x=new");
const u1 = await findUserByEmail("pat.smith@gmail.com");
check("callback: account made with the X name, X id stored", [u1?.name, u1?.xSub], ["Pat Smith", "777001"]);
check("callback: no password, email proven, nothing pending", [hasPassword(u1.passwordHash), Boolean(u1.emailVerifiedAt), u1.emailPending], [false, true, false]);
check("callback: free trial untouched on a first signup", u1.trialScansUsed, 0);
check("callback: token call carried the PKCE verifier and Basic auth", [/code_verifier=/.test(lastTokenCall.body), /^Basic /.test(lastTokenCall.auth)], [true, true]);
check("callback: session cookie is live", (await getSessionUserId(r1.res.cookies.get(SESSION_COOKIE)?.value)) === u1.id);
check("callback: device cookie set, state cookie cleared", [Boolean(r1.res.cookies.get("cf_dev")?.value), r1.res.cookies.get("x_oauth")?.value], [true, ""]);
const log1 = await db.prepare("SELECT src, medium, campaign FROM signup_log WHERE user_id = ?").get(u1.id);
check("callback: signup attribution recorded", [log1?.src, log1?.medium, log1?.campaign], ["tiktok", "social", "post1"]);

// Same X account again = log in (even if X shares no email this time).
const r2 = await roundTrip({ mode: "login", next: "/app/inventory", data: { confirmed_email: undefined } });
check("callback: returning X user goes to next, same account, no second signup row", [
  r2.to.pathname,
  (await findUserByXSub("777001"))?.id === u1.id,
  (await db.prepare("SELECT COUNT(*) AS n FROM signup_log WHERE user_id = ?").get(u1.id)).n,
], ["/app/inventory", true, 1]);
check("callback: unsafe next dropped", (await roundTrip({ mode: "login", next: "//evil.com" })).to.pathname, "/app");

// Link onto an existing proven account.
const old = await createUser("Old", "linkme@example.com", "oldpass99");
await db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(NOW, old.id);
const r3 = await roundTrip({ mode: "login", data: { id: "777002", confirmed_email: "LinkMe@Example.com" } });
const old2 = await findUserByEmail("linkme@example.com");
check("callback: existing email is linked, not duplicated, password kept", [r3.to.pathname, old2.id === old.id, old2.xSub, verifyPassword("oldpass99", old2.passwordHash)], ["/app", true, "777002", true]);

// Never-proven inbox: old password wiped, other sessions out.
const squat = await createUser("Squatter", "victim@example.com", "squatpass1");
const squatSession = await createSession(squat.id);
const r4 = await roundTrip({ mode: "login", data: { id: "777003", confirmed_email: "victim@example.com" } });
const squat2 = await findUserByEmail("victim@example.com");
check("callback: never-proven inbox linked, old password gone, other sessions out", [r4.to.pathname, squat2.xSub, verifyPassword("squatpass1", squat2.passwordHash), await getSessionUserId(squatSession.token)], ["/app", "777003", false, null]);

// Admin / two-step are not opened by X.
await createUser("Boss", "boss@example.com", "bosspass11", "admin");
const r5 = await roundTrip({ mode: "login", data: { id: "777004", confirmed_email: "boss@example.com" } });
check("callback: admin refused with the extra-security flag, nothing linked", [where(r5), r5.res.cookies.get(SESSION_COOKIE)?.value ?? null, (await findUserByEmail("boss@example.com")).xSub], ["/login?x_error=2", null, null]);
const tw = await createUser("Two", "twostep@example.com", "twopass111");
await setTotpSecret(tw.id, "JBSWY3DPEHPK3PXP");
await enableTotp(tw.id);
check("callback: two-step account refused", where(await roundTrip({ mode: "login", data: { id: "777005", confirmed_email: "twostep@example.com" } })), "/login?x_error=2");

// Failures.
const tamper = await roundTrip({ mode: "signup", tamperState: true });
check("fail: tampered state -> signup page flag, no session", [where(tamper), tamper.res.cookies.get(SESSION_COOKIE)?.value ?? null], ["/signup?x_error=1", null]);
check("fail: denied consent -> login page flag", where(await roundTrip({ mode: "login", error: "access_denied" })), "/login?x_error=1");
check("fail: bad profile id", where(await roundTrip({ mode: "signup", data: { id: "not-digits", confirmed_email: "bad@example.com" } })), "/signup?x_error=1");
tokenOk = false;
check("fail: token endpoint refuses", where(await roundTrip({ mode: "signup", data: { id: "777006", confirmed_email: "tok@example.com" } })), "/signup?x_error=1");
tokenOk = true;
check("fail: disposable email -> flag, no account", [where(await roundTrip({ mode: "signup", data: { id: "777007", confirmed_email: "a@mailinator.com" } })), await findUserByEmail("a@mailinator.com")], ["/signup?x_error=1", null]);
testCookies.clear();
const noCookie = await callback.GET(new Request("https://cardflip.io/api/auth/x/callback?code=c&state=abc", { headers: ipHeader() }));
check("fail: no state cookie at all", new URL(noCookie.headers.get("location")).pathname + new URL(noCookie.headers.get("location")).search, "/login?x_error=1");

// No email from X -> pending cookie -> finish.
const r6 = await roundTrip({ mode: "signup", ref: "abcd1234", data: { id: "888001", name: "No Mail", username: "nomail", confirmed_email: undefined } });
const pcookie = r6.res.cookies.get("x_pending");
check("callback: no email -> /signup?x=email, no account, no session", [where(r6), r6.res.cookies.get(SESSION_COOKIE)?.value ?? null, await findUserByXSub("888001")], ["/signup?x=email", null, null]);
check("callback: pending cookie is httpOnly, lax, 15 min, path /, verifies", [pcookie?.httpOnly, pcookie?.sameSite, pcookie?.maxAge, pcookie?.path, sx.verifyXPending(pcookie?.value)?.sub], [true, "lax", 900, "/", "888001"]);

const finishReq = (email, ip = ipHeader()) =>
  finish.POST(new Request("https://cardflip.io/api/auth/x/finish", { method: "POST", headers: { "content-type": "application/json", ...ip }, body: JSON.stringify({ email }) }));

testCookies.clear();
const noPending = await finishReq("nomail@example.com");
check("finish: no pending cookie -> 400, nothing created", [noPending.status, await findUserByEmail("nomail@example.com")], [400, null]);
testCookies.set("x_pending", pcookie.value.slice(0, -3) + "AAA");
check("finish: tampered pending cookie -> 400", (await finishReq("nomail@example.com")).status, 400);
testCookies.set("x_pending", sx.signXPending({ ...okp, sub: "888001", iat: Date.now() - 16 * 60_000 }));
check("finish: expired pending cookie -> 400", (await finishReq("nomail@example.com")).status, 400);

testCookies.set("x_pending", pcookie.value);
check("finish: bad email shape -> 400", (await finishReq("nope")).status, 400);
check("finish: disposable email -> 400", (await finishReq("a@mailinator.com")).status, 400);
check("finish: typo domain -> 400", (await finishReq("a@gmail.con")).status, 400);
const dupe = await finishReq("linkme@example.com");
const dupeBody = await dupe.json();
check("finish: email that already has an account -> 409 with the log-in message, not linked", [dupe.status, dupeBody.error, (await findUserByEmail("linkme@example.com")).xSub], [409, "That email already has an account. Log in with it instead.", "777002"]);

const f1 = await finishReq("NoMail@Example.com");
const f1body = await f1.json();
const u2 = await findUserByEmail("nomail@example.com");
check("finish: 200 with the signup page to resume on", [f1.status, f1body.next], [200, "/signup?step=welcome"]);
check("finish: account has the X id, no password, email NOT proven", [u2?.xSub, hasPassword(u2.passwordHash), u2.emailVerifiedAt, u2.name], ["888001", false, null, "No Mail"]);
check("finish: session + device cookies set, pending cookie cleared", [(await getSessionUserId(f1.cookies.get(SESSION_COOKIE)?.value)) === u2.id, Boolean(f1.cookies.get("cf_dev")?.value), f1.cookies.get("x_pending")?.value], [true, true, ""]);
check("finish: signup logged", (await db.prepare("SELECT COUNT(*) AS n FROM signup_log WHERE user_id = ?").get(u2.id)).n, 1);
check("finish: invite code attached", (await findUserByEmail("nomail@example.com")).referredBy !== undefined);
// Same pending cookie replayed after the account exists: not a second account.
testCookies.set("x_pending", pcookie.value);
check("finish: replay for the same X account -> 409", (await finishReq("another@example.com")).status, 409);

globalThis.fetch = realFetch;

// Not configured: the routes refuse politely.
delete process.env.X_CLIENT_ID;
const off = await start.GET(new Request("https://cardflip.io/api/auth/x/start?mode=signup", { headers: ipHeader() }));
check("no keys: start sends the visitor back with the error flag", new URL(off.headers.get("location")).pathname + new URL(off.headers.get("location")).search, "/signup?x_error=1");
check("no keys: xConfigured is false", sx.xConfigured(), false);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
