/**
 * Email confirmation, end to end through the real routes (emailVerify.ts):
 * signup, the wall, the typed code, the emailed link, Change Email, the trial
 * slot, the SMTP failure modes. Run: npm run test:emailverify
 *
 * Pins:
 *  - SHIP DARK: with no email_confirm settings row (or any value but exactly
 *    "1") nothing is pending, whatever the mail setup; the wall also lifts by
 *    itself if delivery vanishes from the environment;
 *  - signup while on: 201, walled (appAccess false, gates 403 verifyEmail,
 *    checkout 403), a live session, a code that is hashed at rest, no
 *    welcome mail yet, no user-typed text in the mail; login still works;
 *  - the code: 5 wrong tries then refused, claimed atomically (20 parallel
 *    guesses evaluate exactly 5), spaces tolerated, a resend keeps the mail
 *    already in the inbox alive (two live at most), 30 s gap with a readable
 *    wait, idempotent once confirmed;
 *  - the link: GET peek never confirms, POST confirms and touches no session
 *    or cookie, again = already, replaced / expired / bogus each answer right;
 *  - Change Email: one strict validator (lists, names, throwaway, taken),
 *    normalised, saved at once so login and resend agree, the typo's code and
 *    link die; an established account only moves after the code;
 *  - trial slot: pending signups never burn it, the first to confirm keeps the
 *    scans, every door (code, link, reset, admin, switch off) settles the same
 *    way, deleting a never-confirmed account gives the slot back;
 *  - SMTP: a real fake server sees the code mail, the welcome only after
 *    confirmation (escaped, no false free-scan promise); dead, stalled and
 *    over-budget mail releases the account and reports; a refused recipient
 *    keeps the wall; a stalled server cannot hold a signup past ~6 s;
 *  - support mail to an unproven address, the help robot, wishlist alerts;
 *  - review fixes: a proof (code, link, reset link) is for one inbox and a
 *    Change Email racing it confirms nothing; a reset link dies when the
 *    address moves; signup mails an address only so often (per address, per
 *    network per day); Change Email is no free "who has an account" check;
 *    signup resume never skips two-step verification; a lapsed email change is
 *    "expired", never "already confirmed"; a refused address leaves no live
 *    code; a released account's old button says confirmed; the welcome is
 *    sent after the response; the smoke workflow calls the mailbox check.
 *
 * Throwaway db as in test-auth-routes; next/headers is stubbed so
 * requireUser() reads the cookie jar this test fills.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";

for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_CONFIRM_DEV_ECHO", "ANTHROPIC_API_KEY", "VERCEL"]) delete process.env[k];
process.env.EBAY_TOKEN_KEY = "test-signing-key";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-emailverify-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const signup = await import(at("app/api/auth/signup/route.ts"));
const login = await import(at("app/api/auth/login/route.ts"));
const verify = await import(at("app/api/auth/verify-email/route.ts"));
const resend = await import(at("app/api/auth/verify-email/resend/route.ts"));
const confirmRoute = await import(at("app/api/auth/confirm-email/route.ts"));
const account = await import(at("app/api/account/route.ts"));
const reset = await import(at("app/api/auth/reset/route.ts"));
const checkout = await import(at("app/api/billing/checkout/route.ts"));
const comps = await import(at("app/api/ebay/comps/route.ts"));
const { SESSION_COOKIE, emailGate, sellingGate, subscriptionGate } = await import(at("lib/server/auth.ts"));
const { getSessionUserId } = await import(at("lib/server/sessions.ts"));
const { createUser, deleteUser, findUserById, needsEmailConfirm, toPublicUser } = await import(at("lib/server/users.ts"));
const { getSetting, setSetting } = await import(at("lib/server/settings.ts"));
const { issueResetToken, consumeResetToken } = await import(at("lib/server/passwordReset.ts"));
const { _resetRateLimits } = await import(at("lib/server/rateLimit.ts"));
const { todayUtc } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));
const ev = await import(at("lib/server/emailVerify.ts"));
const tickets = await import(at("lib/server/supportTickets.ts"));
const help = await import(at("lib/server/helpChat.ts"));
const { sendSignupWelcomeEmail } = await import(at("lib/server/mail.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

// --- helpers ------------------------------------------------------------------
let ipCounter = 0;
const nextIp = () => `10.7.${++ipCounter >> 8}.${ipCounter & 255}`;
function jpost(body, { ip = nextIp(), cookie } = {}) {
  const headers = { "content-type": "application/json", "fly-client-ip": ip };
  if (cookie) headers.cookie = cookie;
  return new Request("http://test/api", { method: "POST", headers, body: JSON.stringify(body) });
}
const jpatch = (body, ip = nextIp()) =>
  new Request("http://test/api", { method: "PATCH", headers: { "content-type": "application/json", "fly-client-ip": ip }, body: JSON.stringify(body) });
const asUser = (token) => (token ? testCookies.set(SESSION_COOKIE, token) : testCookies.delete(SESSION_COOKIE));
/** Forget every rate-limit window (memory and the shared counter), so a test can resend at once. */
async function clearLimits() {
  _resetRateLimits();
  await db.prepare("DELETE FROM rate_limits").run();
}
async function signUp(email, { name = "Sam", password = "hunter22", ip, device } = {}) {
  const res = await signup.POST(jpost({ name, email, password }, { ip, cookie: device ? `cf_dev=${device}` : undefined }));
  const body = await res.json();
  return { res, status: res.status, body, user: body.user, token: res.cookies?.get(SESSION_COOKIE)?.value ?? null, device: res.cookies?.get("cf_dev")?.value ?? null };
}
const row = (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email);
const rowById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
const vrows = (userId) => db.prepare("SELECT * FROM email_verifications WHERE user_id = ? ORDER BY created_at, rowid").all(userId);
const codeFor = (email) => ev.devLastCode(email)?.code;
const tokenFor = (email) => new URL(ev.devLastCode(email).url).searchParams.get("t");
const tokenIn = (url) => new URL(url).searchParams.get("t");
const wrongCode = (code) => (code === "000000" ? "111111" : "000000");
async function capture(fn, which = "log") {
  const real = console[which];
  const lines = [];
  console[which] = (...a) => lines.push(a.map(String).join(" "));
  try { return [await fn(), lines]; } finally { console[which] = real; }
}
const quiet = (fn) => capture(fn, "error");
const post = async (mod, body, opts) => {
  const res = await mod.POST(jpost(body, opts));
  return { res, status: res.status, body: await res.json() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The welcome mails are sent after the response (afterResponse), so wait for them to land. */
async function until(cond, ms = 4000) {
  for (let t = 0; t < ms && !cond(); t += 25) await sleep(25);
  return cond();
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
// The dev echo logs one line per code mailed; keep them out of the report (capture() still sees them).
const realLog = console.log;
console.log = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("[email-confirm]")) return;
  realLog(...a);
};

// --- a fake SMTP server (accepts, or refuses recipients, or stalls the greeting) ------
function startSmtp({ greetDelayMs = 0 } = {}) {
  // rejectRcpt: 550 on RCPT TO (a typo'd address). rcptReply / fromReply: any other answer, e.g. a quota or rate-limit code.
  const state = { rejectRcpt: false, rcptReply: null, fromReply: null };
  const mails = [];
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
    let mode = "cmd";
    let from = "";
    let rcpts = [];
    let buf = "";
    const send = (s) => sock.write(`${s}\r\n`);
    setTimeout(() => send("220 fake ESMTP"), greetDelayMs);
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (mode === "data") {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) break;
          mails.push({ from, rcpts, data: buf.slice(0, end) });
          buf = buf.slice(end + 5);
          from = "";
          rcpts = [];
          mode = "cmd";
          send("250 OK queued");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i === -1) break;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) sock.write("250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (cmd.startsWith("AUTH")) send("235 2.7.0 ok");
        else if (cmd.startsWith("MAIL FROM")) {
          if (state.fromReply) send(state.fromReply);
          else { from = line; send("250 OK"); }
        }
        else if (cmd.startsWith("RCPT TO")) {
          if (state.rejectRcpt) send("550 5.1.1 no such user");
          else if (state.rcptReply) send(state.rcptReply);
          else { rcpts.push(line.replace(/^RCPT TO:<|>.*$/gi, "")); send("250 OK"); }
        }
        else if (cmd === "DATA") { mode = "data"; send("354 go"); }
        else if (cmd === "QUIT") { send("221 bye"); sock.end(); }
        else send("250 OK");
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ port: server.address().port, mails, state, close: () => { for (const s of sockets) s.destroy(); server.close(); } }),
    ),
  );
}
function decodeQp(s) {
  const bytes = s.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
}
/** Subject header plus every decoded body part of a captured message (text first, then html). */
function readMail(m) {
  const subject = /^Subject: (.*)$/m.exec(m.data)?.[1] ?? "";
  const bodies = [];
  for (const p of m.data.matchAll(/Content-Transfer-Encoding: (base64|quoted-printable|7bit|8bit)\r\n\r\n([\s\S]*?)(?=\r\n--[^\r\n]+|$)/gi)) {
    const enc = p[1].toLowerCase();
    bodies.push(
      enc === "base64" ? Buffer.from(p[2].replace(/\r\n/g, ""), "base64").toString("utf8") : enc === "quoted-printable" ? decodeQp(p[2]) : p[2],
    );
  }
  return { subject, text: bodies[0] ?? "", html: bodies[1] ?? "", all: bodies.join("\n"), headers: m.data.split("\r\n\r\n")[0], to: m.rcpts };
}
/** Words in a mail, minus its links (a random token can spell anything). */
const words = (s) => s.replace(/https?:\/\/\S+/g, "");
const setSmtp = (port) => Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_USER: "cardflip@example.test", SMTP_PASS: "pw" });
const clearSmtp = () => { for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"]) delete process.env[k]; };

// ===== A. Ship dark ================================================================
console.log("A. ship dark");
process.env.EMAIL_CONFIRM_DEV_ECHO = "1";
check("no email_confirm row on a fresh database", await getSetting("email_confirm"), null);
const dark1 = await signUp("dark1@example.com");
check("no row: signup is 201, not walled, app open", [dark1.status, dark1.user.mustConfirmEmail, dark1.user.appAccess, dark1.body.emailSent], [201, false, true, false]);
check("no row: nothing pending in the database", (await row("dark1@example.com")).email_pending, 0);
check("no row: no code made, none logged", [(await vrows(dark1.user.id)).length, codeFor("dark1@example.com")], [0, undefined]);
for (const [i, v] of ["0", "true", "yes", "on", " 1", "1 ", "2", ""].entries()) {
  await setSetting("email_confirm", v);
  const s = await signUp(`darkv${i}@example.com`);
  check(`switch value ${JSON.stringify(v)} is off`, [s.user.mustConfirmEmail, (await row(`darkv${i}@example.com`)).email_pending], [false, 0]);
}
await setSetting("email_confirm", "1");
delete process.env.EMAIL_CONFIRM_DEV_ECHO;
const noMail = await signUp("nomail@example.com");
check('switch "1" but no way to deliver (no SMTP, no echo): not pending', [noMail.user.mustConfirmEmail, (await row("nomail@example.com")).email_pending], [false, 0]);
process.env.EMAIL_CONFIRM_DEV_ECHO = "1";
const failOpenRead = await signUp("failopenread@example.com");
check("pending while delivery exists", failOpenRead.user.mustConfirmEmail, true);
delete process.env.EMAIL_CONFIRM_DEV_ECHO;
const asRow = await findUserById(failOpenRead.user.id);
check("delivery vanishes from the environment: the wall lifts at read time", [needsEmailConfirm(asRow), toPublicUser(asRow).appAccess, subscriptionGate(asRow)], [false, true, null]);
process.env.EMAIL_CONFIRM_DEV_ECHO = "1";
check("delivery back: walled again", needsEmailConfirm(await findUserById(failOpenRead.user.id)), true);
await deleteUser(failOpenRead.user.id);

// ===== B. Signup while on ==========================================================
console.log("B. signup while on");
const [sam, samLog] = await capture(() => signUp("sam@example.com", { name: "Sam <b>Evil</b>" }));
check("signup: 201", sam.status, 201);
check("signup: walled, app closed, code on its way", [sam.user.mustConfirmEmail, sam.user.appAccess, sam.body.emailSent, sam.body.emailProblem], [true, false, true, null]);
check("signup: code expiry is about an hour out", sam.user.emailCodeExpiresAt > Date.now() + 59 * 60_000 && sam.user.emailCodeExpiresAt < Date.now() + 61 * 60_000);
check("signup: live session cookie", Boolean(sam.token && (await getSessionUserId(sam.token)) === sam.user.id));
const samRow = await row("sam@example.com");
check("signup: pending, never verified", [samRow.email_pending, samRow.email_verified_at], [1, null]);
check("signup: the dev echo logged to, code and link", /^\[email-confirm\] to=sam@example\.com code=\d{6} link=http\S+\/confirm-email\?t=\S+$/.test(samLog[0] ?? ""));
check("signup: 6 digits", /^\d{6}$/.test(codeFor("sam@example.com")));
const atRest = JSON.stringify((await vrows(sam.user.id)).map((r) => [r.link_hash, r.code_hash, r.email]));
check("signup: only hashes at rest, never the code or the token", !atRest.includes(codeFor("sam@example.com")) && !atRest.includes(tokenFor("sam@example.com")));
check("signup: one live row for the signup address", (await vrows(sam.user.id)).map((r) => [r.email, r.dead_at, r.confirmed_at, r.attempts]), [["sam@example.com", null, null, 0]]);
check("signup: DB-backed limiter counted the request", Number((await db.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key LIKE 'auth:signup:%'").get()).n) > 0);
check("signup: same email, wrong password → 409", (await signUp("sam@example.com", { password: "nope-nope" })).status, 409);
check("signup: an existing confirmation-free account → 409", (await signUp("dark1@example.com")).status, 409);

// Gates
const samUser = await findUserById(sam.user.id);
const gate = subscriptionGate(samUser);
check("gate: subscriptionGate is 403 verifyEmail, not the 402 paywall", [gate.status, (await gate.json()).verifyEmail], [403, true]);
check("gate: sellingGate is 403 verifyEmail too", [sellingGate(samUser).status, (await sellingGate(samUser).json()).verifyEmail], [403, true]);
check("gate: emailGate takes a message", (await emailGate(samUser, "Hello").json()).error, "Hello");
asUser(sam.token);
const co = await checkout.POST(jpost({ plan: "standard" }));
check("gate: checkout is 403 with its own wording", [co.status, (await co.json()).error], [403, "Confirm your email first, then you can subscribe."]);
check("gate: eBay comps is 403", (await comps.POST(jpost({ card: { name: "Charizard" } }))).status, 403);
const lg = await login.POST(jpost({ email: "sam@example.com", password: "hunter22" }));
check("gate: login still works and says walled", [lg.status, (await lg.json()).user.mustConfirmEmail], [200, true]);
const status1 = await (await verify.GET()).json();
check("status poll: pending, with the newest code's expiry", [status1.pending, status1.user.mustConfirmEmail, typeof status1.user.emailCodeExpiresAt], [true, true, "number"]);
asUser(null);
check("no session: verify GET, verify POST and resend are 401", [(await verify.GET()).status, (await verify.POST(jpost({ code: "123456" }))).status, (await resend.POST(jpost({}))).status], [401, 401, 401]);

// The typed code
console.log("C. the typed code");
asUser(sam.token);
const samCode1 = codeFor("sam@example.com");
const bad = wrongCode(samCode1);
const tries = [];
for (let i = 0; i < 5; i++) tries.push(await post(verify, { code: bad }));
check("code: four wrong tries count down", tries.slice(0, 4).map((t) => [t.status, t.body.error, t.body.triesLeft]), [[400, "wrong_code", 4], [400, "wrong_code", 3], [400, "wrong_code", 2], [400, "wrong_code", 1]]);
check("code: the wrong-try message reads plainly", tries[0].body.message, "That code isn't right. 4 tries left.");
check("code: the fifth wrong try says to ask for a new code", [tries[4].status, tries[4].body.error, tries[4].body.message], [400, "too_many", "Too many tries. Tap Send a New Code."]);
check("code: after five misses even the right code is refused", (await post(verify, { code: samCode1 })).body.error, "too_many");
check("code: not six digits → 400 invalid_code", [(await post(verify, { code: "abc" })).body.error, (await post(verify, {})).body.error], ["invalid_code", "invalid_code"]);
check("code: still walled", (await rowById(sam.user.id)).email_pending, 1);

// Resend: a fresh row with fresh tries, a 30 s gap, the old mail stays alive
const rsEarly = await post(resend, {});
check("resend: right after signup the same 30 s gap applies (signup used the address's allowance)", [rsEarly.status, rsEarly.body.error], [429, "slow_down"]);
await clearLimits();
const rs1 = await post(resend, {});
check("resend: 200, sent, with the client's cooldown", [rs1.status, rs1.body.ok, rs1.body.sent, rs1.body.cooldownSeconds], [200, true, true, 30]);
const samCode2 = codeFor("sam@example.com");
check("resend: a new code, and the old row is kept beside it", [samCode2 !== samCode1, (await vrows(sam.user.id)).length, (await vrows(sam.user.id)).filter((r) => r.dead_at == null).length], [true, 2, 2]);
const early = await resend.POST(jpost({}));
const earlyBody = await early.json();
check("resend: a second tap inside 30 s is a 429 with a readable wait", [early.status, earlyBody.error, /^Wait \d+ seconds?, then try again\.$/.test(earlyBody.message), earlyBody.retryAfterSeconds > 0, Number(early.headers.get("Retry-After")) > 0], [429, "slow_down", true, true, true]);
check("resend: the refused tap made no new code", codeFor("sam@example.com"), samCode2);
check("code: formatting is forgiven ('482 913' and 'Code: 482913')", [
  (await post(verify, { code: `Code: ${wrongCode(samCode2).slice(0, 3)} ${wrongCode(samCode2).slice(3)}` })).body.error,
], ["wrong_code"]);

// Confirm with the newer code
await clearLimits();
const okc = await post(verify, { code: samCode2 });
check("code: the right code confirms", [okc.status, okc.body.ok, okc.body.wasPending, okc.body.user.mustConfirmEmail, okc.body.user.appAccess], [200, true, true, false, true]);
const samAfter = await row("sam@example.com");
check("code: pending cleared, inbox stamped", [samAfter.email_pending, typeof samAfter.email_verified_at], [0, "number"]);
check("code: the signup session is untouched", (await getSessionUserId(sam.token)) === sam.user.id);
check("code: every row is kept and marked confirmed, none left live", (await vrows(sam.user.id)).every((r) => r.confirmed_at != null && r.dead_at == null));
check("code: the gate is open now (checkout gets as far as billing being off)", [subscriptionGate(await findUserById(sam.user.id)), (await checkout.POST(jpost({ plan: "standard" }))).status], [null, 503]);
const again = await post(verify, { code: samCode2 });
check("code: again after confirming is a harmless 200", [again.status, again.body.alreadyConfirmed, again.body.user.appAccess], [200, true, true]);
const codeBefore = codeFor("sam@example.com");
await clearLimits();
const rsDone = await post(resend, {});
check("resend after confirming: alreadyConfirmed, and no new code", [rsDone.status, rsDone.body.alreadyConfirmed, codeFor("sam@example.com")], [200, true, codeBefore]);
check("status poll after confirming: not pending", (await (await verify.GET()).json()).pending, false);
check("Change Email is refused for an account that is not walled", (await post(resend, { email: "x@y.co" })).body.error, "use_account");
check("helpers: mask and code cleaning", [ev.maskEmail("sam@example.com"), ev.cleanCode("Code: 482 913"), ev.cleanCode("12345"), ev.cleanCode(482913)], ["s***@example.com", "482913", null, null]);

// D. A resend keeps the mail already in the inbox alive; two live at most
console.log("D. resend and brute force");
const two = await signUp("two@example.com");
const twoC1 = codeFor("two@example.com");
await clearLimits();
asUser(two.token);
await post(resend, {});
const twoC2 = codeFor("two@example.com");
check("resend: the first code still works after a resend", [twoC1 !== twoC2, (await post(verify, { code: twoC1 })).body.ok], [true, true]);

const three = await signUp("three@example.com");
const threeC1 = codeFor("three@example.com");
const threeTok1 = tokenFor("three@example.com");
asUser(three.token);
await clearLimits();
await post(resend, {});
const threeC2 = codeFor("three@example.com");
await clearLimits();
await post(resend, {});
const threeC3 = codeFor("three@example.com");
check("resend: a third code retires the first; the second and third stay live", (await vrows(three.user.id)).map((r) => r.dead_at != null), [true, false, false]);
check("resend: the retired code is refused like any wrong guess", (await post(verify, { code: threeC1 })).body.error, "wrong_code");
const threePeek = await (await confirmRoute.GET(new Request(`http://test/api?t=${encodeURIComponent(threeTok1)}`, { headers: { "fly-client-ip": nextIp() } }))).json();
check("resend: the retired mail's button says it was replaced", threePeek.state, "replaced");
check("resend: the middle code still confirms", (await post(verify, { code: threeC2 })).body.ok, true);
check("resend: confirming leaves every row confirmed or retired, none live", (await vrows(three.user.id)).every((r) => r.confirmed_at != null || r.dead_at != null), true);
check("resend: the third code is now just a confirmed row", threeC3 !== threeC2);

const par = await signUp("parallel@example.com");
const parWrong = wrongCode(codeFor("parallel@example.com"));
const parResults = await Promise.all(Array.from({ length: 20 }, () => ev.confirmWithCode(par.user.id, parWrong)));
check("20 parallel wrong guesses: exactly 5 are ever evaluated", [parResults.filter((r) => r.state === "wrong").length, parResults.filter((r) => r.state === "too_many").length], [5, 15]);
check("...the counter stops at 5", (await vrows(par.user.id))[0].attempts, 5);
check("...and then even the right code is refused", (await ev.confirmWithCode(par.user.id, codeFor("parallel@example.com"))).state, "too_many");

const lim = await signUp("limits@example.com");
asUser(lim.token);
const limStatuses = [];
for (let i = 0; i < 12; i++) limStatuses.push((await verify.POST(jpost({ code: "12345x" }, { ip: "198.51.100.77" }))).status);
check("verify: the per-account limiter stops the 11th try with a readable wait", [limStatuses.filter((s) => s === 400).length, limStatuses[10]], [10, 429]);
const limBody = await (await verify.POST(jpost({ code: "123456" }, { ip: "198.51.100.78" }))).json();
check("verify: the wait is in minutes, not raw seconds", /about \d+ minutes\.$/.test(limBody.message), true);
await clearLimits();

// E. The emailed link
console.log("E. the emailed link");
const peekReq = (t) => new Request(`http://test/api/auth/confirm-email?t=${encodeURIComponent(t)}`, { headers: { "fly-client-ip": nextIp() } });
const l1 = await signUp("link1@example.com");
const l1tok = tokenFor("link1@example.com");
const p1 = await (await confirmRoute.GET(peekReq(l1tok))).json();
await confirmRoute.GET(peekReq(l1tok));
check("link: a peek (twice, like a mail scanner) says valid and masks the address", p1, { state: "valid", email: "l***@example.com" });
check("link: ...and confirms nothing", (await row("link1@example.com")).email_pending, 1);
asUser(null);
const c1r = await confirmRoute.POST(jpost({ t: l1tok }));
const c1b = await c1r.json();
check("link: POST confirms, with no session at all", [c1r.status, c1b.ok, c1b.state, c1b.already], [200, true, "confirmed", false]);
// (10-05) a fresh confirmation signs that browser in; this used to pin "touches no cookie".
const c1cookie = c1r.cookies.get(SESSION_COOKIE);
check("link: a fresh confirmation signs in (signedIn, a new session cookie for this account)", [c1b.signedIn, Boolean(c1cookie?.value), c1cookie?.value !== l1.token, (await getSessionUserId(c1cookie?.value ?? "")) === l1.user.id], [true, true, true, true]);
check("link: the signup session is still live and the account is in", [(await getSessionUserId(l1.token)) === l1.user.id, (await row("link1@example.com")).email_pending, typeof (await row("link1@example.com")).email_verified_at], [true, 0, "number"]);
const c1again = await (await confirmRoute.POST(jpost({ t: l1tok }))).json();
check("link: opening it again is already-confirmed, not an error", [c1again.ok, c1again.already], [true, true]);
const c1again2 = await confirmRoute.POST(jpost({ t: l1tok }));
check("link: reopened within 15 minutes it still signs in (a script-running mail scanner may have confirmed first)", (await c1again2.json()).signedIn, true);
await db.prepare("UPDATE email_verifications SET confirmed_at = confirmed_at - ? WHERE confirmed_at IS NOT NULL").run(20 * 60 * 1000);
const c1late = await confirmRoute.POST(jpost({ t: l1tok }));
check("link: a used link older than 15 minutes signs nobody in (no signedIn, no cookie), so the mail is not a reusable login", [(await c1late.json()).signedIn, c1late.cookies.getAll().length], [false, 0]);
check("link: a peek now says confirmed", (await (await confirmRoute.GET(peekReq(l1tok))).json()).state, "confirmed");
asUser(l1.token);
check("link: typing the code after the link is a harmless 200", (await post(verify, { code: "123456" })).body.alreadyConfirmed, true);

const l2 = await signUp("link2@example.com");
const l2tok = tokenFor("link2@example.com");
asUser(l2.token);
await post(verify, { code: codeFor("link2@example.com") });
check("link: opened after confirming by code → confirmed, not expired", (await (await confirmRoute.GET(peekReq(l2tok))).json()).state, "confirmed");

const l3 = await signUp("link3@example.com");
const l3tok = tokenFor("link3@example.com");
await db.prepare("UPDATE email_verifications SET expires_at = ? WHERE user_id = ?").run(Date.now() - 1000, l3.user.id);
asUser(null);
const l3r = await confirmRoute.POST(jpost({ t: l3tok }));
check("link: an expired one peeks expired, POSTs 400, confirms nothing", [(await (await confirmRoute.GET(peekReq(l3tok))).json()).state, l3r.status, (await l3r.json()).error, (await row("link3@example.com")).email_pending], ["expired", 400, "expired", 1]);
asUser(l3.token);
check("link: the same row's code is expired too", (await post(verify, { code: codeFor("link3@example.com") })).body.error, "expired");
asUser(null);
const bogus = await confirmRoute.POST(jpost({ t: "bogus" }));
check("link: a bogus token peeks expired and POSTs 400", [(await (await confirmRoute.GET(peekReq("bogus"))).json()).state, bogus.status, (await confirmRoute.POST(jpost({}))).status], ["expired", 400, 400]);

// F. Change Email
console.log("F. Change Email");
const f1 = await signUp("typo@gmial.net");
const typoCode = codeFor("typo@gmial.net");
const typoTok = tokenFor("typo@gmial.net");
asUser(f1.token);
const refusals = [
  ["a@x.com,b@y.com", 400, "invalid_email"],
  ["Bob <b@y.com>", 400, "invalid_email"],
  ["a@x.com;b@y.com", 400, "invalid_email"],
  ["nobody", 400, "invalid_email"],
  ["x@mailinator.com", 400, "disposable_email"],
  ["sam@example.com", 409, "email_taken"],
];
for (const [email, status, error] of refusals) {
  await clearLimits();
  const r = await post(resend, { email });
  check(`Change Email: ${email} → ${status} ${error}`, [r.status, r.body.error], [status, error]);
}
check("Change Email: the refusals wrote and mailed nothing", [(await rowById(f1.user.id)).email, codeFor("typo@gmial.net")], ["typo@gmial.net", typoCode]);
await clearLimits();
const fix = await post(resend, { email: "  Fixed.Address@Example.com " });
check("Change Email: a good address → 200 sent, normalised", [fix.status, fix.body.sent, fix.body.user.email, fix.body.user.mustConfirmEmail], [200, true, "fixed.address@example.com", true]);
check("Change Email: saved at once, and the code went to the new address", [(await rowById(f1.user.id)).email, /^\d{6}$/.test(codeFor("fixed.address@example.com") ?? "")], ["fixed.address@example.com", true]);
check("Change Email: the typo's rows are dead, only the new address is live", (await vrows(f1.user.id)).map((r) => [r.email, r.dead_at != null]), [["typo@gmial.net", true], ["fixed.address@example.com", false]]);
check("Change Email: the typo's code no longer confirms", (await post(verify, { code: typoCode })).body.error, "wrong_code");
asUser(null);
const typoPost = await confirmRoute.POST(jpost({ t: typoTok }));
check("Change Email: the typo owner's link peeks replaced and confirms nothing", [(await (await confirmRoute.GET(peekReq(typoTok))).json()).state, typoPost.status, (await typoPost.json()).error, (await rowById(f1.user.id)).email_pending, (await rowById(f1.user.id)).email], ["replaced", 400, "replaced", 1, "fixed.address@example.com"]);
asUser(f1.token);
check("Change Email: the wall reads the new address", (await (await verify.GET()).json()).user.email, "fixed.address@example.com");
await clearLimits();
const beforeNew = codeFor("fixed.address@example.com");
await post(resend, {});
check("Change Email: Send a New Code goes to the corrected address, not the typo", [codeFor("fixed.address@example.com") !== beforeNew, codeFor("typo@gmial.net")], [true, typoCode]);
const typoLogin = await login.POST(jpost({ email: "typo@gmial.net", password: "hunter22" }));
const fixLogin = await login.POST(jpost({ email: "FIXED.address@EXAMPLE.com", password: "hunter22" }));
check("Change Email: login works with the corrected address in any case, not the typo", [typoLogin.status, fixLogin.status], [401, 200]);
check("Change Email: the new code lets them in", (await post(verify, { code: codeFor("fixed.address@example.com") })).body.user.appAccess, true);

const f2 = await signUp("mixedcase-typo@example.com");
asUser(f2.token);
await clearLimits();
await post(resend, { email: "Mixed@Case.com" });
await post(verify, { code: codeFor("mixed@case.com") });
check("mixed case: stored lower-case, confirmed, login works either way", [
  (await rowById(f2.user.id)).email,
  (await login.POST(jpost({ email: "Mixed@Case.com", password: "hunter22" }))).status,
  (await login.POST(jpost({ email: "mixed@case.com", password: "hunter22" }))).status,
], ["mixed@case.com", 200, 200]);

const f3 = await signUp("patch-typo@example.com");
asUser(f3.token);
await clearLimits();
check("account PATCH (walled): a list is refused", (await account.PATCH(jpatch({ email: "a@x.com,b@y.com" }))).status, 400);
check("account PATCH (walled): a throwaway inbox is refused", (await account.PATCH(jpatch({ email: "p@mailinator.com" }))).status, 400);
check("account PATCH (walled): a taken address is refused", (await account.PATCH(jpatch({ email: "sam@example.com" }))).status, 409);
const pa = await account.PATCH(jpatch({ email: "patched@example.com" }));
const pab = await pa.json();
check("account PATCH (walled): moves with no password and mails the new address", [pa.status, pab.emailSent, pab.user.email, pab.user.mustConfirmEmail, /^\d{6}$/.test(codeFor("patched@example.com") ?? "")], [200, true, "patched@example.com", true, true]);

// G. An established account moves its email only after the code
console.log("G. an established account changes its email");
const est = await createUser("Est", "est@example.com", "hunter22");
const estToken = (await login.POST(jpost({ email: "est@example.com", password: "hunter22" }))).cookies.get(SESSION_COOKIE).value;
asUser(estToken);
// A confirmed neighbour on the same device, so a settle run by mistake would zero est's trial.
await db.prepare("UPDATE users SET trial_scans_used = 3 WHERE id = ?").run(est.id);
const neighbour = await row("dark1@example.com");
await db.prepare("INSERT INTO signup_log (user_id, ip_hash, device_id, at) VALUES (?, 'shared-ip-hash', 'shared-device-est', ?)").run(est.id, Date.now());
await db.prepare("UPDATE signup_log SET ip_hash = 'shared-ip-hash', device_id = 'shared-device-est' WHERE user_id = ?").run(neighbour.id);
const e1 = await account.PATCH(jpatch({ email: "New-Est@Example.com", currentPassword: "wrong" }));
check("established: the wrong password is refused", [e1.status, (await e1.json()).error], [400, "Current password is incorrect"]);
check("established: a throwaway inbox is refused", (await account.PATCH(jpatch({ email: "x@mailinator.com", currentPassword: "hunter22" }))).status, 400);
check("established: a taken address is refused", (await account.PATCH(jpatch({ email: "dark1@example.com", currentPassword: "hunter22" }))).status, 409);
const e2 = await account.PATCH(jpatch({ email: "New-Est@Example.com", currentPassword: "hunter22" }));
const e2b = await e2.json();
check("established: a change mails a code to the NEW address and answers pendingEmail", [e2.status, e2b.pendingEmail, typeof e2b.emailCodeExpiresAt, e2b.user.email, e2b.user.mustConfirmEmail], [200, "new-est@example.com", "number", "est@example.com", false]);
check("established: users.email has not moved, the old address still logs in", [(await rowById(est.id)).email, (await login.POST(jpost({ email: "est@example.com", password: "hunter22" }))).status], ["est@example.com", 200]);
check("established: the code went to the new address", /^\d{6}$/.test(codeFor("new-est@example.com") ?? ""));
const acctGet = await (await account.GET()).json();
check("established: the account page can see the change waiting", [acctGet.pendingEmail?.email, acctGet.user.email], ["new-est@example.com", "est@example.com"]);
const e3 = await account.PATCH(jpatch({ email: "other-est@example.com", currentPassword: "hunter22" }));
check("established: a second change inside 30 s is a 429", [e3.status, (await e3.json()).error], [429, "slow_down"]);
await clearLimits();
const estRs = await post(resend, {});
check("established: resend goes to the pending address, no body needed", [estRs.status, estRs.body.sent, estRs.body.pendingEmail], [200, true, "new-est@example.com"]);
check("established: resend refuses a body email (use the account page)", (await post(resend, { email: "z@example.com" })).body.error, "use_account");
const estCode = codeFor("new-est@example.com");
check("established: a wrong code changes nothing", [(await post(verify, { code: wrongCode(estCode) })).body.error, (await rowById(est.id)).email], ["wrong_code", "est@example.com"]);
const ev1 = await post(verify, { code: estCode });
check("established: the code moves the sign-in email", [ev1.status, ev1.body.ok, ev1.body.wasPending, ev1.body.user.email], [200, true, false, "new-est@example.com"]);
const estAfter = await rowById(est.id);
check("established: stamped as proven; trial and wall untouched (no settle, no pending)", [estAfter.email, typeof estAfter.email_verified_at, estAfter.trial_scans_used, estAfter.email_pending], ["new-est@example.com", "number", 3, 0]);
check("established: login follows the new address", [(await login.POST(jpost({ email: "est@example.com", password: "hunter22" }))).status, (await login.POST(jpost({ email: "new-est@example.com", password: "hunter22" }))).status], [401, 200]);
check("established: nothing waiting any more", (await (await account.GET()).json()).pendingEmail, null);
await setSetting("email_confirm", "0");
await clearLimits();
const e5 = await account.PATCH(jpatch({ email: "est-direct@example.com", currentPassword: "hunter22" }));
const e5b = await e5.json();
check("confirmation off: the change is immediate, with no code, as before", [e5.status, e5b.pendingEmail, e5b.user.email, (await rowById(est.id)).email], [200, undefined, "est-direct@example.com", "est-direct@example.com"]);
await setSetting("email_confirm", "1");

// H. The free trial slot
console.log("H. the free trial slot");
const dev1 = "trialslot-device-1";
const hA = await signUp("slot-a@example.com", { device: dev1 });
const hB = await signUp("slot-b@example.com", { device: dev1 });
check("a pending signup does not burn the slot: the next on the device is not a repeat", [(await row("slot-a@example.com")).trial_scans_used, (await row("slot-b@example.com")).trial_scans_used], [0, 0]);
asUser(hB.token);
const hBc = await post(verify, { code: codeFor("slot-b@example.com") });
check("the first to confirm keeps the free scans", [hBc.body.user.trialScansLeft, (await row("slot-b@example.com")).trial_scans_used], [5, 0]);
asUser(hA.token);
const hAc = await post(verify, { code: codeFor("slot-a@example.com") });
check("the second to confirm starts with the trial spent, and the answer says so", [hAc.body.ok, hAc.body.user.trialScansLeft, (await row("slot-a@example.com")).trial_scans_used], [true, 0, 5]);

const dev2 = "trialslot-device-2";
const hC = await signUp("slot-c@example.com", { device: dev2 });
const hD = await signUp("slot-d@example.com", { device: dev2 });
asUser(hC.token);
await post(verify, { code: codeFor("slot-c@example.com") });
const rt = await issueResetToken({ id: hD.user.id, email: "slot-d@example.com" });
await consumeResetToken(rt.token, "brand-new-pw");
const hDrow = await row("slot-d@example.com");
check("a reset link is a door too, and settles the same way (no second trial)", [(await row("slot-c@example.com")).trial_scans_used, hDrow.trial_scans_used, hDrow.email_pending, typeof hDrow.email_verified_at], [0, 5, 0, "number"]);
check("reset: the squatter's signup session is gone", await getSessionUserId(hD.token), null);

const sameIp = "203.0.113.50";
const hE = await signUp("slot-e@example.com", { ip: sameIp });
const hF = await signUp("slot-f@example.com", { ip: sameIp });
asUser(hE.token);
await post(verify, { code: codeFor("slot-e@example.com") });
asUser(hF.token);
await post(verify, { code: codeFor("slot-f@example.com") });
check("the same IP settles too: first keeps the scans, second starts spent", [(await row("slot-e@example.com")).trial_scans_used, (await row("slot-f@example.com")).trial_scans_used], [0, 5]);

// 10-01: one Gmail inbox under other spellings (dots, +tag), each from its own device and network.
const hG1 = await signUp("slot.gmail@gmail.com");
const hG2 = await signUp("slotgmail+2@gmail.com");
check("a pending spelling does not burn the inbox's slot either", [(await row("slot.gmail@gmail.com")).trial_scans_used, (await row("slotgmail+2@gmail.com")).trial_scans_used], [0, 0]);
await ev.markEmailConfirmed(hG1.user.id);
await ev.markEmailConfirmed(hG2.user.id);
check("the same Gmail inbox settles too: the first spelling keeps the scans, the second starts spent", [(await row("slot.gmail@gmail.com")).trial_scans_used, (await row("slotgmail+2@gmail.com")).trial_scans_used], [0, 5]);
const hG3 = await signUp("slot-typo@example.com");
await ev.changePendingEmail({ id: hG3.user.id, email: "slot-typo@example.com" }, "s.l.o.t.gmail@gmail.com");
await ev.markEmailConfirmed(hG3.user.id);
check("Change Email on a waiting signup moves it to the new inbox's slot", (await row("s.l.o.t.gmail@gmail.com")).trial_scans_used, 5);
await signUp("slotgmail+4@gmail.com");
check("once an inbox has a confirmed account, a new spelling starts spent at signup", (await row("slotgmail+4@gmail.com")).trial_scans_used, 5);

const dev3 = "trialslot-device-3";
const hG = await signUp("slot-g@example.com", { device: dev3 });
await deleteUser(hG.user.id);
check("deleting a never-confirmed signup gives the slot back", Number((await db.prepare("SELECT COUNT(*) AS n FROM signup_log WHERE device_id = ?").get(dev3)).n), 0);
const hH = await signUp("slot-h@example.com", { device: dev3 });
asUser(hH.token);
check("...so the corrected re-signup gets the free scans", (await post(verify, { code: codeFor("slot-h@example.com") })).body.user.trialScansLeft, 5);
await deleteUser(hH.user.id);
const hI = await signUp("slot-i@example.com", { device: dev3 });
check("deleting a CONFIRMED account keeps the slot used: the next starts spent", (await row("slot-i@example.com")).trial_scans_used, 5);

const dev4 = "trialslot-device-4";
const hJ = await signUp("slot-j@example.com", { device: dev4 });
const hK = await signUp("slot-k@example.com", { device: dev4 });
const adminJ = await ev.markEmailConfirmed(hJ.user.id);
const adminK = await ev.markEmailConfirmed(hK.user.id);
check("an admin's Mark Confirmed settles too: first keeps, second spent", [adminJ.changed, adminK.changed, (await row("slot-j@example.com")).trial_scans_used, (await row("slot-k@example.com")).trial_scans_used], [true, true, 0, 5]);
check("...and doing it twice changes nothing", (await ev.markEmailConfirmed(hK.user.id)).changed, false);

const rst = await signUp("reset-route@example.com");
const rstTok = await issueResetToken({ id: rst.user.id, email: "reset-route@example.com" });
asUser(null);
const rstRes = await post(reset, { token: rstTok.token, password: "reset-pass-9" });
check("reset route: the seller is in, no wall", [rstRes.status, rstRes.body.user.mustConfirmEmail, rstRes.body.user.appAccess], [200, false, true]);

// K. A signup that comes back
console.log("K. a signup that comes back");
const k1 = await signUp("resume@example.com");
const k1code = codeFor("resume@example.com");
await clearLimits();
const k2 = await signUp("resume@example.com");
const k2code = codeFor("resume@example.com");
check("resume: same password picks the account up (200, resumed, still walled)", [k2.status, k2.body.resumed, k2.user.mustConfirmEmail, k2.body.emailSent], [200, true, true, true]);
check("resume: a new live session for the same account, and a fresh code", [Boolean(k2.token) && k2.token !== k1.token && (await getSessionUserId(k2.token)) === k1.user.id, k2code !== k1code], [true, true]);
const k3 = await signUp("resume@example.com");
check("resume: again inside the gap mails nothing new but says a code is on its way", [k3.body.emailSent, codeFor("resume@example.com")], [true, k2code]);
check("resume: a wrong password is the usual 409", (await signUp("resume@example.com", { password: "not-the-one" })).status, 409);

// L. Deleting an account
console.log("L. deleting an account");
const d1 = await signUp("delete-me@example.com");
await deleteUser(d1.user.id);
check("delete: the codes and the signup log row go with a pending account", [(await vrows(d1.user.id)).length, Number((await db.prepare("SELECT COUNT(*) AS n FROM signup_log WHERE user_id = ?").get(d1.user.id)).n)], [0, 0]);
const d2 = await signUp("delete-me-2@example.com");
asUser(d2.token);
await post(verify, { code: codeFor("delete-me-2@example.com") });
await deleteUser(d2.user.id);
check("delete: a confirmed account's codes go, its signup log row stays", [(await vrows(d2.user.id)).length, Number((await db.prepare("SELECT COUNT(*) AS n FROM signup_log WHERE user_id = ?").get(d2.user.id)).n)], [0, 1]);

// M. The switch going off, and the admin numbers
console.log("M. switch off, stats");
const dev5 = "trialslot-device-5";
const m1 = await signUp("rel-1@example.com", { device: dev5 });
const m2 = await signUp("rel-2@example.com", { device: dev5 });
const m3 = await signUp("rel-3@example.com", { device: dev5 });
const m1tok = tokenFor("rel-1@example.com");
const st1 = await ev.emailConfirmStats();
check("stats: on, deliverable, accounts waiting, the day's budget", [st1.on, st1.deliverable, st1.waiting >= 3, st1.dayBudget], [true, true, true, ev.CONFIRM_MAIL_DAY_BUDGET]);
const released = await ev.releaseAllPending();
check("switch off: everyone waiting is let in", [released >= 3, Number((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE email_pending = 1").get()).n)], [true, 0]);
check("switch off: oldest first keeps the free scans, the rest start spent", [(await rowById(m1.user.id)).trial_scans_used, (await rowById(m2.user.id)).trial_scans_used, (await rowById(m3.user.id)).trial_scans_used], [0, 5, 5]);
check("switch off: nobody is stamped as verified, and their mail's button says confirmed (they are in), not a Send a New Code that is not there", [(await rowById(m1.user.id)).email_verified_at, (await (await confirmRoute.GET(peekReq(m1tok))).json()).state, (await confirmRoute.POST(jpost({ t: m1tok }))).status], [null, "confirmed", 200]);
check("switch off: again releases nobody", await ev.releaseAllPending(), 0);
check("stats: nobody waiting afterwards", (await ev.emailConfirmStats()).waiting, 0);

// N. Support mail and the help robot for an unproven address
console.log("N. support and the help robot");
const w = await signUp("walled-help@example.com");
const wUser = await findUserById(w.user.id);
const calls = [];
const ticketMail = { mail: { support: async () => { calls.push("support"); }, receipt: async () => { calls.push("receipt"); } } };
const wt = await tickets.openTicket(wUser, { subject: "Code never came", body: "Nothing in my inbox" }, [], ticketMail);
check("ticket (unconfirmed): the support copy goes out, the receipt to the unproven address does not", calls, ["support"]);
let mailed = 0;
await tickets.replyToTicket(wt.id, { body: "We are on it" }, { replyMail: async () => { mailed++; }, push: async () => {} });
await tickets.setTicketStatus(wt.id, "closed", { closedMail: async () => { mailed++; } });
check("ticket (unconfirmed): replies and the closed notice stay on the site", mailed, 0);
calls.length = 0;
const samNow = await findUserById(sam.user.id);
const ct = await tickets.openTicket(samNow, { subject: "Question", body: "How do I list?" }, [], ticketMail);
await tickets.replyToTicket(ct.id, { body: "Tap List" }, { replyMail: async () => { mailed++; }, push: async () => {} });
await tickets.setTicketStatus(ct.id, "closed", { closedMail: async () => { mailed++; } });
check("ticket (confirmed): receipt, reply and closed mail all still go", [calls, mailed], [["support", "receipt"], 2]);
process.env.ANTHROPIC_API_KEY = "test-key";
for (let i = 0; i < 5; i++) {
  await db.prepare("INSERT INTO help_messages (id, user_id, role, content, created_at) VALUES (?, ?, 'user', 'q', ?)").run(`hm-${i}`, w.user.id, Date.now() - i * 1000);
}
let capErr = null;
try { await help.askHelp(wUser, "hello"); } catch (err) { capErr = err; }
check("help robot: an unconfirmed signup gets 5 questions, not 40", [capErr instanceof help.HelpCapError, capErr?.cap, help.HELP_PENDING_CAP], [true, 5, 5]);
delete process.env.ANTHROPIC_API_KEY;

// P. A proof vouches for one inbox
console.log("P. a proof vouches for one inbox");
const openResets = async (userId) => Number((await db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND used_at IS NULL").get(userId)).n);
const insertReset = (token, userId, email) =>
  db.prepare("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, email) VALUES (?, ?, ?, ?, ?)").run(sha256(token), userId, Date.now(), Date.now() + 3600_000, email);
const pa1 = await signUp("bind-a@example.com");
const pa1Reset = await issueResetToken({ id: pa1.user.id, email: "bind-a@example.com" }); // what Forgot Password mails to the inbox on file
check("reset link: recorded with the address it was mailed to", (await db.prepare("SELECT email FROM password_resets WHERE user_id = ?").get(pa1.user.id)).email, "bind-a@example.com");
asUser(pa1.token);
await clearLimits();
const pa1Move = await account.PATCH(jpatch({ email: "bind-victim@example.com" }));
check("reset link: Change Email (a walled account, no password) moves the account", [pa1Move.status, (await rowById(pa1.user.id)).email], [200, "bind-victim@example.com"]);
check("reset link: ...and the link mailed to the old address dies with the move", [await openResets(pa1.user.id), await consumeResetToken(pa1Reset.token, "stolen-pass-1")], [0, null]);
await insertReset("survivor-token", pa1.user.id, "bind-a@example.com"); // a link that outlived the move some other way
const survivor = await consumeResetToken("survivor-token", "stolen-pass-2");
const pa1Row = await rowById(pa1.user.id);
check("reset link: one that survived anyway sets a password but confirms nothing for the new address", [Boolean(survivor), pa1Row.email, pa1Row.email_pending, pa1Row.email_verified_at], [true, "bind-victim@example.com", 1, null]);
const pa2 = await signUp("bind-legacy@example.com");
await db.prepare("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha256("legacy-token"), pa2.user.id, Date.now(), Date.now() + 3600_000);
await consumeResetToken("legacy-token", "legacy-pass-1");
check("reset link: one made before addresses were recorded resets the password but proves no inbox", [(await rowById(pa2.user.id)).email_pending, (await rowById(pa2.user.id)).email_verified_at], [1, null]);
const pa3 = await signUp("bind-same@example.com");
await insertReset("same-token", pa3.user.id, "bind-same@example.com");
await consumeResetToken("same-token", "same-pass-1");
check("reset link: for the address still on file it still confirms", [(await rowById(pa3.user.id)).email_pending, typeof (await rowById(pa3.user.id)).email_verified_at], [0, "number"]);

const pr = await signUp("race-a@example.com");
const prCode = codeFor("race-a@example.com");
await db.prepare("UPDATE users SET email = 'race-x@example.com' WHERE id = ?").run(pr.user.id); // a Change Email landing between the read and the flip
const prFlip = await ev.markEmailConfirmed(pr.user.id, { email: "race-a@example.com" });
check("race: the flip is bound to the address it proved", [prFlip.changed, (await rowById(pr.user.id)).email_pending, (await rowById(pr.user.id)).email_verified_at], [false, 1, null]);
const prRes = await ev.confirmWithCode(pr.user.id, prCode);
const prAfter = await rowById(pr.user.id);
check("race: the code for the old address confirms nothing on the moved account", [prRes.state, prAfter.email, prAfter.email_pending, prAfter.email_verified_at], ["stale", "race-x@example.com", 1, null]);
check("race: ...and its used row is retired as replaced, not left 'confirmed'", (await vrows(pr.user.id)).map((r) => [r.confirmed_at, r.dead_at != null]), [[null, true]]);
check("race: the new address's own proof still confirms (case-insensitive)", (await ev.markEmailConfirmed(pr.user.id, { email: "Race-X@Example.com" })).changed, true);

// Q. Signup mails an inbox only so often
console.log("Q. signup mails an inbox only so often");
await clearLimits();
const qa = await signUp("q-target@example.com", { ip: "198.51.100.201" });
await deleteUser(qa.user.id);
const qb = await signUp("q-target@example.com", { ip: "198.51.100.202" });
check("signup: the same address again inside 30 s is a 429 with a readable wait, and makes no account", [qb.status, qb.body.error, /^Wait \d+ seconds?, then try again\.$/.test(qb.body.message), (await row("q-target@example.com")) === undefined], [429, "slow_down", true, true]);
const qStatuses = [];
const slideGap = () => db.prepare("UPDATE rate_limits SET window_start = window_start - 60000 WHERE key = 'auth:code:to:q-loop@example.com|30000'").run();
for (let i = 0; i < 5; i++) {
  _resetRateLimits();
  await slideGap();
  const q = await signUp("q-loop@example.com", { ip: nextIp() });
  qStatuses.push(q.status);
  if (q.user) await deleteUser(q.user.id);
}
_resetRateLimits();
await slideGap();
const q6 = await signUp("q-loop@example.com", { ip: nextIp() });
check("signup: five an hour per address, then a wait in minutes (sign up, delete, repeat cannot keep mailing one inbox)", [qStatuses, q6.status, /about \d+ minutes\.$/.test(q6.body.message)], [[201, 201, 201, 201, 201], 429, true]);

await clearLimits();
const dayIp = "198.51.100.210";
await db.prepare("INSERT INTO rate_limits (key, count, window_start) VALUES (?, 30, ?)").run(`auth:code:day:${dayIp}|86400000`, Date.now());
const qd = await signUp("q-day@example.com", { ip: dayIp });
check("network cap: a network that used its 30 codes today gets a 429 in hours, and no account", [qd.status, qd.body.error, /about \d+ hours\.$/.test(qd.body.message), (await row("q-day@example.com")) === undefined], [429, "slow_down", true, true]);
const qe = await signUp("q-day-other@example.com", { ip: nextIp() });
check("network cap: another network is not affected", qe.status, 201);
const dropAddressKeys = async () => {
  _resetRateLimits();
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'auth:code:to:%' OR key LIKE 'auth:code:acct:%'").run();
};
await dropAddressKeys();
asUser(qe.token);
const qr = await resend.POST(jpost({}, { ip: dayIp }));
check("network cap: Send a New Code from that network is refused too", [qr.status, /about \d+ hours\.$/.test((await qr.json()).message)], [429, true]);
await dropAddressKeys();
const qp = await account.PATCH(jpatch({ email: "q-moved@example.com" }, dayIp));
check("network cap: so is Change Email on the account page, and nothing moved", [qp.status, (await rowById(qe.user.id)).email], [429, "q-day-other@example.com"]);
await dropAddressKeys();
const qCodeBefore = codeFor("q-day-other@example.com");
const qResume = await signUp("q-day-other@example.com", { ip: dayIp });
check("network cap: a signup coming back from that network resumes but mails nothing new", [qResume.status, qResume.body.resumed, qResume.body.emailSent, codeFor("q-day-other@example.com")], [200, true, true, qCodeBefore]);
check("helper: waits read in seconds, minutes, then hours",[ev.waitMessage(24), ev.waitMessage(3421), ev.waitMessage(72000)], ["Wait 24 seconds, then try again.", "Too many tries. Try again in about 58 minutes.", "Too many tries. Try again in about 20 hours."]);

// R. Change Email is not a free look at who has an account
console.log("R. Change Email is no free look at who has an account");
const ro = await signUp("oracle@example.com");
asUser(ro.token);
await clearLimits();
const roIp = "198.51.100.220";
const roTaken = [];
for (let i = 0; i < 12; i++) roTaken.push((await resend.POST(jpost({ email: "sam@example.com" }, { ip: roIp }))).status);
check("oracle: probing a registered address is capped per account: ten answers, then 429s", [roTaken.filter((st) => st === 409).length, roTaken.slice(10)], [10, [429, 429]]);
const roFree = await resend.POST(jpost({ email: "nobody-here@example.com" }, { ip: roIp }));
const roSam = await resend.POST(jpost({ email: "sam@example.com" }, { ip: roIp }));
check("oracle: past the cap a free and a registered address get exactly the same answer", [roFree.status, roSam.status, (await roFree.json()).error, (await roSam.json()).error], [429, 429, "slow_down", "slow_down"]);
check("oracle: the account page shares the same cap", (await account.PATCH(jpatch({ email: "sam@example.com" }, roIp))).status, 429);
const ro2 = await signUp("oracle2@example.com");
asUser(ro2.token);
const ro2s = [];
for (let i = 0; i < 8; i++) ro2s.push((await resend.POST(jpost({ email: "sam@example.com" }, { ip: roIp }))).status);
check("oracle: the network's own limit binds across accounts", [ro2s[0], ro2s.at(-1)], [409, 429]);

// S. Resume is a password-only sign-in, so it never applies to two-step accounts
console.log("S. resume and two-step");
const ts = await signUp("totp-resume@example.com");
await db.prepare("UPDATE users SET totp_secret = 'JBSWY3DPEHPK3PXP', totp_enabled_at = ? WHERE id = ?").run(Date.now(), ts.user.id);
await clearLimits();
const tsAgain = await signUp("totp-resume@example.com");
check("resume: an account with two-step on gets the usual 409 and no session", [tsAgain.status, tsAgain.token], [409, null]);

// T. An email change whose code ran out
console.log("T. an email change whose code ran out");
const ex = await createUser("Ex", "ex@example.com", "hunter22");
const exToken = (await login.POST(jpost({ email: "ex@example.com", password: "hunter22" }))).cookies.get(SESSION_COOKIE).value;
asUser(exToken);
await clearLimits();
await account.PATCH(jpatch({ email: "ex-new@example.com", currentPassword: "hunter22" }));
const exCode = codeFor("ex-new@example.com");
await db.prepare("UPDATE email_verifications SET expires_at = ? WHERE user_id = ?").run(Date.now() - 1000, ex.id);
check("lapsed change: the account page lists no live change any more", (await (await account.GET()).json()).pendingEmail, null);
check("lapsed change: ...but the server still knows one was asked for", (await ev.lastChangeAttempt({ id: ex.id, email: "ex@example.com" }))?.email, "ex-new@example.com");
const exVerify = await post(verify, { code: exCode });
check("lapsed change: typing the old code says expired, not 'already confirmed', and the email did not move", [exVerify.status, exVerify.body.error, exVerify.body.alreadyConfirmed, (await rowById(ex.id)).email], [400, "expired", undefined, "ex@example.com"]);
await clearLimits();
const exResend = await post(resend, {});
check("lapsed change: Send a New Code mails the new address again, not 'already confirmed'", [exResend.status, exResend.body.sent, exResend.body.pendingEmail, exResend.body.alreadyConfirmed], [200, true, "ex-new@example.com", undefined]);
const exNew = codeFor("ex-new@example.com");
check("lapsed change: the new code moves the sign-in email", [exNew !== exCode, (await post(verify, { code: exNew })).body.user.email], [true, "ex-new@example.com"]);
check("lapsed change: once it landed, a stale screen hears 'already confirmed' (nothing is waiting)", (await post(verify, { code: exNew })).body.alreadyConfirmed, true);
await clearLimits();
await account.PATCH(jpatch({ email: "ex-again@example.com", currentPassword: "hunter22" }));
await ev.killVerifications(ex.id);
check("dropped change: a dead request is not an attempt, so a stale screen clears and users.email is still the old one", [(await ev.lastChangeAttempt({ id: ex.id, email: "ex-new@example.com" })), (await post(verify, { code: "123456" })).body.alreadyConfirmed, (await rowById(ex.id)).email], [null, true, "ex-new@example.com"]);

// J. Real mail through a fake SMTP server
console.log("J. mail delivery");
delete process.env.EMAIL_CONFIRM_DEV_ECHO;
const smtp = await startSmtp();
setSmtp(smtp.port);
await clearLimits();
const j1 = await signUp("smtp1@example.com", { name: "<b>Evil</b> Name", device: "smtp-device-1" });
check("smtp: signup is walled and the one mail goes out", [j1.user.mustConfirmEmail, j1.body.emailSent, smtp.mails.length], [true, true, 1]);
const codeMail = readMail(smtp.mails[0]);
// (10-05) signup mail is link-only: no code anywhere, one big button plus the plain URL.
check("smtp: link-only subject, no code in the subject", codeMail.subject, "Confirm your CardFlip email");
check("smtp: one recipient, the address typed", codeMail.to, ["smtp1@example.com"]);
check("smtp: text and HTML carry the link, HTML has the Confirm and open CardFlip button, and no 6-digit code anywhere", [/confirm-email\?t=/.test(codeMail.text), codeMail.html.includes("Confirm and open CardFlip"), codeMail.html.includes("confirm-email?t="), /\b\d{6}\b/.test(words(codeMail.all))], [true, true, true, false]);
check("smtp: nothing the user typed is in it, and no welcome promise yet", !/Evil|Welcome|free|Reply/i.test(words(codeMail.all)));
asUser(null);
const j1tok = decodeURIComponent(/confirm-email\?t=([^\s"&<]+)/.exec(codeMail.text)[1]);
const jc = await confirmRoute.POST(jpost({ t: j1tok }));
check("smtp: the link from the mail confirms and signs in", [(await jc.json()).signedIn, Boolean(jc.cookies.get(SESSION_COOKIE)?.value)], [true, true]);
check("smtp: the welcome goes out after confirming, not before (2 mails)", [await until(() => smtp.mails.length >= 2), smtp.mails.length], [true, 2]);
const w1 = readMail(smtp.mails[1]);
check("smtp: welcome — free scans, Help pointer, no 'reply to this email'", [/scans are free/.test(w1.text), /Tap Help in the app/.test(w1.text), !/Reply to this email/i.test(w1.all), w1.to], [true, true, true, ["smtp1@example.com"]]);
check("smtp: welcome — the typed first name is escaped in the HTML", [w1.html.includes("&lt;b>Evil&lt;/b>"), !w1.html.includes("<b>Evil</b>")], [true, true]);

const j2 = await signUp("smtp2@example.com", { device: "smtp-device-1" });
check("smtp: a repeat signup's welcome is not sent at signup (only its confirmation mail)", smtp.mails.length, 3);
const j2tok = decodeURIComponent(new RegExp("confirm-email\\?t=([^\\s\"&<]+)").exec(readMail(smtp.mails[2]).text)[1]);
asUser(null);
await confirmRoute.POST(jpost({ t: j2tok }));
// The link answers no user: the repeat signup's scan count is read from its row.
const jc2 = { body: { user: toPublicUser(await findUserById(j2.user.id)) } };
await until(() => smtp.mails.length >= 4);
const w2 = readMail(smtp.mails[3]);
check("smtp: a repeat signup lands with no free scans and the welcome does not promise any", [jc2.body.user.trialScansLeft, !/scans are free/.test(words(w2.all)), w2.html.includes("Start Scanning"), !/Pick a Plan|pick one|Scan Pack/.test(w2.all)], [0, true, true, true]);

await setSetting("email_confirm", "0");
const offBefore = smtp.mails.length;
const off = await signUp("switch-off-welcome@example.com");
check("switch off: signup is unchanged (open at once) and its welcome still arrives, sent after the response", [off.user.mustConfirmEmail, await until(() => smtp.mails.length > offBefore), readMail(smtp.mails[offBefore]).subject], [false, true, "Welcome to CardFlip, Sam"]);
await setSetting("email_confirm", "1");

const j3 = await signUp("smtp3@example.com");
const mailsBeforeAdmin = smtp.mails.length;
await ev.markEmailConfirmed(j3.user.id);
check("smtp: an admin's Mark Confirmed sends no welcome to a possibly wrong address", smtp.mails.length, mailsBeforeAdmin);

// The daily confirmation-mail budget
const budgetKey = `confirm_mail_${todayUtc()}`;
await db.prepare("INSERT INTO price_history_meta (key, value) VALUES (?, '99999') ON CONFLICT(key) DO UPDATE SET value = '99999'").run(budgetKey);
const mailsBeforeBudget = smtp.mails.length;
const jb = await signUp("budget@example.com");
check("budget spent: signup skips the wall, sends no mail, and is not stranded", [jb.user.mustConfirmEmail, jb.body.emailSent, smtp.mails.length - mailsBeforeBudget, (await row("budget@example.com")).email_pending], [false, false, 0, 0]);
check("budget spent: reported to the Errors page as email-confirm", (await db.prepare("SELECT message FROM error_events WHERE source = 'email-confirm'").all()).some((e) => /budget/.test(e.message)));
await db.prepare("DELETE FROM price_history_meta WHERE key = ?").run(budgetKey);

// A refused recipient keeps the wall
smtp.state.rejectRcpt = true;
const jr = await signUp("refused@example.com");
check("smtp: a refused recipient keeps the wall and says so (201)", [jr.status, jr.user.mustConfirmEmail, jr.body.emailSent, jr.body.emailProblem], [201, true, false, "recipient"]);
asUser(jr.token);
await clearLimits();
const jrr = await post(resend, {});
check("smtp: resend to a refused address is 400 recipient_refused and still walled", [jrr.status, jrr.body.error, jrr.body.user.mustConfirmEmail], [400, "recipient_refused", true]);
check("smtp: a refused address leaves no live code behind (coming back re-sends instead of saying 'we sent a code')", [jr.user.emailCodeExpiresAt ?? null, await ev.liveVerification(jr.user.id), (await (await verify.GET()).json()).user.emailCodeExpiresAt], [null, null, null]);
smtp.state.rejectRcpt = false;
await clearLimits();
const jfix = await post(resend, { email: "refused-fixed@example.com" });
check("smtp: Change Email to a good address goes through", [jfix.status, jfix.body.sent, smtp.mails.at(-1).rcpts], [200, true, ["refused-fixed@example.com"]]);
const jk = await signUp("kept-good@example.com");
asUser(jk.token);
smtp.state.rejectRcpt = true;
await clearLimits();
const jkr = await post(resend, {});
smtp.state.rejectRcpt = false;
check("smtp: a refused resend retires only its own row; the mail already delivered still works", [jkr.body.error, (await vrows(jk.user.id)).map((r) => r.dead_at != null)], ["recipient_refused", [false, true]]);
check("smtp: a refused address is logged under its own Errors source, not as an outage", [
  Number((await db.prepare("SELECT COUNT(*) AS n FROM error_events WHERE source = 'email-confirm-address'").get()).n) >= 2,
  (await ev.emailConfirmStats()).refusedLast24h >= 2,
], [true, true]);

// A quota or a blocked sender is OUR problem: it must release, never wall (only a 5xx on RCPT TO is a typo)
const failedBefore = (await ev.emailConfirmStats()).failedLast24h;
smtp.state.fromReply = "550 5.7.1 sender blocked";
const jq1 = await signUp("sender-blocked@example.com");
smtp.state.fromReply = null;
smtp.state.rcptReply = "452 4.5.3 sending limit reached";
const jq2 = await signUp("rate-limited@example.com");
smtp.state.rcptReply = null;
check("smtp: sender refused or a 4xx rate limit releases the account instead of walling it", [jq1.user.mustConfirmEmail, jq2.user.mustConfirmEmail, jq1.body.emailProblem, jq2.body.emailProblem], [false, false, null, null]);
check("smtp: ...and both count as outages on the Switches numbers", (await ev.emailConfirmStats()).failedLast24h - failedBefore, 2);

// One address only, at the delivery door itself
const beforeMulti = smtp.mails.length;
const multi = await ev.deliverConfirmCode("a@x.com,b@y.com", "123456", "http://x");
check("deliver: a list of addresses is refused, nothing sent", [multi.ok, multi.kind, smtp.mails.length - beforeMulti], [false, "recipient", 0]);
check("issue: a list of addresses is refused", await ev.issueEmailVerification({ id: "nobody" }, "a@x.com,b@y.com").then(() => "issued", () => "refused"), "refused");

// The user's account welcome/support mail
const wsup = await signUp("support-copy@example.com");
const wsupUser = await findUserById(wsup.user.id);
const supportBefore = smtp.mails.length;
await tickets.openTicket(wsupUser, { subject: "No code", body: "It never came" }, []);
const supportMail = readMail(smtp.mails[supportBefore]);
check("support copy for an unconfirmed signup: no Reply-To at the unproven address, and it says so", [!/^Reply-To:/im.test(supportMail.headers), /Email not confirmed yet/.test(supportMail.all), smtp.mails.length - supportBefore], [true, true, 1]);

// SMTP dead: the wall lifts, it does not strand
setSmtp(1);
const t0 = Date.now();
const jd = await signUp("dead@example.com");
check("dead SMTP: signup still 201, released, app open, quickly", [jd.status, jd.user.mustConfirmEmail, jd.user.appAccess, jd.body.emailSent, (await row("dead@example.com")).email_pending, Date.now() - t0 < 5000], [201, false, true, false, 0, true]);
check("dead SMTP: reported as email-confirm", (await db.prepare("SELECT message FROM error_events WHERE source = 'email-confirm'").all()).some((e) => /transport/.test(e.message)));

setSmtp(smtp.port);
await clearLimits();
const jz = await signUp("failopen-resend@example.com");
check("resend fail-open: walled while mail works", jz.user.mustConfirmEmail, true);
setSmtp(1);
await clearLimits();
asUser(jz.token);
const jzr = await post(resend, {});
check("resend fail-open: mail broke since, so Send a New Code lets them in", [jzr.status, jzr.body.released, jzr.body.sent, jzr.body.user.mustConfirmEmail, (await rowById(jz.user.id)).email_pending], [200, true, false, false, 0]);

await clearLimits();
asUser(estToken);
const eLate = await account.PATCH(jpatch({ email: "est-late@example.com", currentPassword: "hunter22" }));
const eLateB = await eLate.json();
check("established change with mail down: 503, address unchanged, no code left live", [eLate.status, eLateB.code, (await rowById(est.id)).email, (await ev.liveVerification(est.id))], [503, "mail_unavailable", "est-direct@example.com", null]);

// A stalled server cannot hold a signup
setSmtp(smtp.port);
const sw = await signUp("stall-welcome@example.com");
const swTok = decodeURIComponent(new RegExp("confirm-email\\?t=([^\\s\"&<]+)").exec(readMail(smtp.mails.at(-1)).text)[1]);
const slow = await startSmtp({ greetDelayMs: 7500 });
setSmtp(slow.port);
const s0 = Date.now();
const js = await signUp("slow@example.com");
const took = Date.now() - s0;
// The server would have answered at 7.5 s and taken the mail; released means the 6 s bound fired first.
check("stalled SMTP: the signup gives up at ~6 s (well inside the phone's 15 s), account exists, released", [js.status, js.user.mustConfirmEmail, took >= 5500 && took < 12000, (await row("slow@example.com")).email_pending], [201, false, true, 0]);
// The welcome goes out after the response: a stalled mailbox cannot hold the phone on "Confirming…".
setSmtp(slow.port);
asUser(null);
const sw0 = Date.now();
const swRes = await confirmRoute.POST(jpost({ t: swTok }));
const swBody = await swRes.json();
check("welcome after the response: a stalled mailbox does not hold the link being confirmed", [swBody.ok, (await row("stall-welcome@example.com")).email_pending, Date.now() - sw0 < 3000], [true, 0, true]);
await setSetting("email_confirm", "0");
const so0 = Date.now();
const jo = await signUp("slow-off@example.com");
check("switch off with a stalled mailbox: the signup answers at once, the welcome is sent after", [jo.status, jo.user.mustConfirmEmail, Date.now() - so0 < 3000], [201, false, true]);
await setSetting("email_confirm", "1");
await quiet(async () => { // the two abandoned welcomes fail noisily when the stalled server goes away
  slow.close();
  await sleep(300);
});

const never = await ev.sendBounded(() => new Promise(() => {}), 40);
check("sendBounded: a send that never answers is given up on", [never.ok, never.kind], [false, "transport"]);
let unhandled = 0;
const onUnhandled = () => { unhandled++; };
process.on("unhandledRejection", onUnhandled);
await ev.sendBounded(() => new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 80)), 20);
await sleep(250);
process.off("unhandledRejection", onUnhandled);
check("sendBounded: the abandoned send failing later is not an unhandled rejection", unhandled, 0);
check("classify: only the recipient's own permanent refusal is the user's to fix", [
  ev.classifySendError({ code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }),
  ev.classifySendError({ command: "RCPT TO", responseCode: 553 }),
  ev.classifySendError({ code: "EENVELOPE" }), // an address nodemailer cannot parse
  ev.classifySendError({ code: "EENVELOPE", command: "MAIL FROM", responseCode: 550 }), // our sender was refused
  ev.classifySendError({ code: "EENVELOPE", command: "RCPT TO", responseCode: 452 }), // a rate limit
  ev.classifySendError({ code: "EAUTH", command: "AUTH PLAIN", responseCode: 535 }),
  ev.classifySendError({ code: "ECONNECTION" }),
  ev.classifySendError({ code: "ETIMEDOUT" }),
  ev.classifySendError({ command: "CONN", responseCode: 421 }),
  ev.classifySendError(new Error("boom")),
  ev.classifySendError(null),
], ["recipient", "recipient", "recipient", "transport", "transport", "transport", "transport", "transport", "transport", "transport", "transport"]);

// The mailbox heartbeat (a GitHub workflow can call it; no mail is sent)
const mailCheck = await import(at("app/api/ops/mail-check/route.ts"));
process.env.OPS_KEY = "ops-key";
process.env.SOCIAL_POST_KEY = "post-key";
const mcReq = (key) => new Request("http://test/api/ops/mail-check", { headers: key ? { authorization: `Bearer ${key}` } : {} });
check("mail-check: no key or the wrong key → 401", [(await mailCheck.GET(mcReq(null))).status, (await mailCheck.GET(mcReq("nope"))).status], [401, 401]);
clearSmtp();
check("mail-check: mail not set up → 503", (await mailCheck.GET(mcReq("ops-key"))).status, 503);
setSmtp(smtp.port);
const mailsBeforeCheck = smtp.mails.length;
const mcOk = await mailCheck.GET(mcReq("ops-key"));
check("mail-check: the mailbox answers → 200 ok, and nothing was sent", [mcOk.status, (await mcOk.json()).ok, smtp.mails.length - mailsBeforeCheck], [200, true, 0]);
setSmtp(1);
const mcBad = await mailCheck.GET(mcReq("ops-key"));
check("mail-check: the mailbox will not answer → 502 with the reason", [mcBad.status, (await mcBad.json()).ok], [502, false]);
// The ops key and the posting key are two keys (10-01 sweep): neither opens the other's routes.
const opsAlertRoute = await import(at("app/api/ops/alert/route.ts"));
const alertReq = (key) => new Request("http://test/api/ops/alert", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ workflow: "CI" }) });
check("ops routes refuse the posting key", [(await mailCheck.GET(mcReq("post-key"))).status, (await opsAlertRoute.POST(alertReq("post-key"))).status], [401, 401]);
delete process.env.OPS_KEY;
check("ops key unset → nobody gets in, not even an empty or the posting key", [(await mailCheck.GET(mcReq("post-key"))).status, (await mailCheck.GET(mcReq("undefined"))).status, (await opsAlertRoute.POST(alertReq("post-key"))).status], [401, 401, 401]);
delete process.env.SOCIAL_POST_KEY;
const wf = (name) => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
check("workflows: ci, prod-smoke and ebay-research hold only the ops key; social-post and social-bio only the posting key", [
  ...["ci", "prod-smoke", "ebay-research"].map((n) => wf(n).includes("secrets.OPS_KEY") && !wf(n).includes("SOCIAL_POST_KEY")),
  ...["social-post", "social-bio"].map((n) => wf(n).includes("secrets.SOCIAL_POST_KEY") && !wf(n).includes("OPS_KEY")),
], [true, true, true, true, true]);
check("routes: the three ops routes read the ops key only; the publisher, TikTok cron and bios never read it", [
  ...["app/api/ops/alert/route.ts", "app/api/ops/mail-check/route.ts", "app/api/ops/ebay-marketplaces/route.ts"].map((p) => src(p).includes("opsKeyOk(req)") && !src(p).includes("SOCIAL_POST_KEY")),
  ...["app/api/social/publish/route.ts", "app/api/cron/social-tiktok/route.ts", "app/api/ops/social-bio/route.ts"].map((p) => src(p).includes("process.env.SOCIAL_POST_KEY") && !src(p).includes("OPS_KEY") && !src(p).includes("opsKeyOk")),
], [true, true, true, true, true, true]);
const smokeYml = readFileSync(new URL("../.github/workflows/prod-smoke.yml", import.meta.url), "utf8");
const mailStep = smokeYml.indexOf("api/ops/mail-check");
check("mail-check: the production smoke workflow calls it (GitHub's own failure mail is the alarm), after the smoke run and before the site-mail alert", [
  /curl[^\n]*--fail[^\n]*https:\/\/cardflip\.io\/api\/ops\/mail-check/.test(smokeYml),
  mailStep > smokeYml.indexOf("scripts/prod-smoke.mjs"),
  mailStep < smokeYml.indexOf("name: Email Chris"),
], [true, true, true]);

// The welcome mail's own rules
setSmtp(smtp.port);
const wm = smtp.mails.length;
await sendSignupWelcomeEmail("named@example.com", "Sam\r\nBcc: evil@x.com", 0);
const wmail = readMail(smtp.mails[wm]);
check("welcome: a name cannot inject a header", [/^Bcc:/im.test(wmail.headers), wmail.to], [false, ["named@example.com"]]);

smtp.close();
clearSmtp();
console.log(failures === 0 ? "\nAll email-confirmation checks passed" : `\n${failures} email-confirmation check(s) failed`);
// No process.exit(): it would skip the beforeExit hook that closes the libsql
// client, and on Windows that open handle asserts at exit (see lib/db.ts).
process.exitCode = failures === 0 ? 0 : 1;
