/**
 * Email confirmation, the browser side (src/lib/client/emailConfirm.ts and the
 * screens built on it). No browser, no server: fetch is stubbed with the exact
 * bodies the routes answer (scripts/test-email-verify.mjs pins the routes), so
 * this pins how the UI reads them. Run: npm run test:emailconfirmui
 *
 * Pins:
 *  - the code box: any paste comes out as six digits ("482 913", "Code: 482913"),
 *    and the panel has no maxLength (it would cut the paste before the strip);
 *  - the wall's poll: 5 s, then 30 s after about two minutes;
 *  - every refusal reads right: wrong_code carries triesLeft, a plain per-IP 429
 *    becomes "Wait 24 seconds", 401 is signed_out, a dead network is a message;
 *  - resend: sent / released (wall lifted) / already confirmed / recipient_refused
 *    (carries the user so the typo screen shows the address on file);
 *  - the link page: peek states, POST errors (replaced / expired / email_taken);
 *  - the account family (PATCH /api/account) answers { error, code? } and its
 *    429 is the verify family's { error: "slow_down", message };
 *  - signup() carries emailSent / emailProblem / resumed; a walled checkout
 *    is sent to /app instead of a dead-end error;
 *  - regressions from the plan review: the shared panel never touches
 *    SessionProvider (the signup page has none), no hard-coded "5 scans" on the
 *    signup page, the anonymous phone-width loop covers /confirm-email;
 *  - review fixes: waits read in hours, a signup 429 shows its message, an
 *    email change only counts as changed when the address moved (a lapsed
 *    code is not "Email changed"), a mistyped new address has a way out, the
 *    Change Email form has no invented countdown, a walled Plan row offers no
 *    purchase, the switch-off signup screen is the old one, and no help copy
 *    promises email replies to an account that is sent none.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const ec = await import(at("lib/client/emailConfirm.ts"));
const { signup } = await import(at("lib/client/auth.ts"));
const { startCheckout } = await import(at("lib/client/accountApi.ts"));

// --- fetch stub --------------------------------------------------------------

const calls = [];
let queue = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const next = queue.shift();
  if (!next) throw new Error(`unexpected fetch ${url}`);
  if (next instanceof Error) throw next;
  const [status, body] = next;
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
};
const answer = (...replies) => {
  queue = replies;
  calls.length = 0;
};
const bodyOf = (i = 0) => JSON.parse(calls[i].init.body);

const rejects = async (fn, check) => {
  try {
    await fn();
  } catch (err) {
    check(err);
    return;
  }
  assert.fail("expected a rejection");
};

const walledUser = { id: "u1", name: "Sam Seller", email: "sam@example.com", mustConfirmEmail: true, emailCodeExpiresAt: 1_800_000_000_000, trialScansLeft: 5 };
const openUser = { id: "u1", name: "Sam Seller", email: "sam@example.com", mustConfirmEmail: false, trialScansLeft: 5, features: { magic: true } };

// --- the code box ------------------------------------------------------------

assert.equal(ec.digitsOnly("482913"), "482913");
assert.equal(ec.digitsOnly("482 913"), "482913", "spaced paste");
assert.equal(ec.digitsOnly("Code: 482913"), "482913", "text around the code");
assert.equal(ec.digitsOnly("48-29-13"), "482913");
assert.equal(ec.digitsOnly("12345678"), "123456", "never more than six");
assert.equal(ec.digitsOnly("Your code is 482913 at 3 pm"), "482913", "the first six digits win");
assert.equal(ec.digitsOnly("abc"), "");
assert.equal(ec.CODE_LENGTH, 6);

// --- the poll ----------------------------------------------------------------

assert.equal(ec.pollDelayMs(0), 5_000);
assert.equal(ec.pollDelayMs(119_999), 5_000);
assert.equal(ec.pollDelayMs(120_000), 30_000, "backs off after about two minutes");
assert.equal(ec.pollDelayMs(3_600_000), 30_000);

// --- merging the user the server just described ------------------------------

// The verify routes answer a user without features / hasCards; those survive the merge.
const lifted = { id: "u1", name: "Sam Seller", email: "sam@example.com", mustConfirmEmail: false, trialScansLeft: 0 };
const merged = ec.mergeUser({ ...walledUser, features: { magic: true }, hasCards: true }, lifted);
assert.equal(merged.mustConfirmEmail, false);
assert.equal("emailCodeExpiresAt" in merged, false, "the code expiry is dropped once the wall is gone");
assert.deepEqual(merged.features, { magic: true }, "fields the verify routes leave out survive");
assert.equal(merged.hasCards, true);
assert.equal(merged.trialScansLeft, 0, "fields from the newer answer win");
assert.equal(ec.mergeUser(openUser, { ...walledUser }).emailCodeExpiresAt, walledUser.emailCodeExpiresAt, "kept while walled");
assert.equal(ec.mergeUser(null, walledUser).email, "sam@example.com");

// --- readable waits ----------------------------------------------------------

assert.equal(ec.waitMessage(24), "Wait 24 seconds, then try again.");
assert.equal(ec.waitMessage(1), "Wait 1 second, then try again.");
assert.equal(ec.waitMessage(900), "Too many tries. Try again in about 15 minutes.");
assert.equal(ec.waitMessage(3421), "Too many tries. Try again in about 58 minutes.");

assert.equal(ec.waitMessage(5399), "Too many tries. Try again in about 90 minutes.");
assert.equal(ec.waitMessage(5400), "Too many tries. Try again in about 2 hours.", "long waits read in hours");
assert.equal(ec.waitMessage(72_000), "Too many tries. Try again in about 20 hours.");

// --- did the email change land? --------------------------------------------

assert.equal(ec.changeLanded({ email: "New@Example.com" }, { email: "new@example.com" }), true, "the address moved to the one asked for");
assert.equal(ec.changeLanded({ email: "old@example.com" }, { email: "new@example.com" }), false, "'already confirmed' with the old address is a change that lapsed, not one that landed");
assert.equal(ec.changeLanded({ email: "old@example.com" }, null), false);

// --- GET: the wall's poll ----------------------------------------------------

answer([200, { pending: true, user: walledUser }]);
assert.deepEqual(await ec.checkVerifyState(), { pending: true, user: walledUser });
answer([200, { pending: false, user: openUser }]);
assert.equal((await ec.checkVerifyState()).pending, false);
answer([401, { error: "Not signed in" }]);
assert.equal(await ec.checkVerifyState(), null, "signed out reads as null, not a throw");
answer([500, {}]);
await rejects(() => ec.checkVerifyState(), (e) => assert.match(e.message, /500/));

// --- POST: the typed code ----------------------------------------------------

answer([200, { ok: true, wasPending: true, user: openUser }]);
const ok = await ec.submitCode("482913");
assert.deepEqual(bodyOf(), { code: "482913" });
assert.equal(calls[0].init.method, "POST");
assert.equal(ok.wasPending, true);
assert.equal(ok.alreadyConfirmed, false);
assert.equal(ok.user.trialScansLeft, 5);

answer([200, { ok: true, alreadyConfirmed: true, user: { ...openUser, trialScansLeft: 0 } }]);
const already = await ec.submitCode("482913");
assert.equal(already.alreadyConfirmed, true);
assert.equal(already.user.trialScansLeft, 0, "the confirmed user's count is what the You're-in step reads (a repeat signup can be 0)");

answer([400, { error: "wrong_code", message: "That code isn't right. 3 tries left.", triesLeft: 3, maxTries: 5 }]);
await rejects(() => ec.submitCode("111111"), (e) => {
  assert.ok(e instanceof ec.VerifyError);
  assert.equal(e.code, "wrong_code");
  assert.equal(e.triesLeft, 3);
  assert.equal(e.message, "That code isn't right. 3 tries left.");
});
for (const [code, message] of [
  ["too_many", "Too many tries. Tap Send a New Code."],
  ["expired", "That code has expired. Tap Send a New Code."],
  ["invalid_code", "Enter the 6-digit code."],
]) {
  answer([400, { error: code, message }]);
  await rejects(() => ec.submitCode("111111"), (e) => {
    assert.equal(e.code, code);
    assert.equal(e.message, message);
  });
}
answer([429, { error: "slow_down", message: "Wait 24 seconds, then try again.", retryAfterSeconds: 24 }]);
await rejects(() => ec.submitCode("111111"), (e) => {
  assert.equal(e.code, "slow_down");
  assert.equal(e.message, "Wait 24 seconds, then try again.");
  assert.equal(e.retryAfterSeconds, 24);
});
answer([429, { error: "Too many requests — try again in 3421s", retryAfterSeconds: 3421 }]);
await rejects(() => ec.submitCode("111111"), (e) => assert.equal(e.message, "Too many tries. Try again in about 58 minutes.", "never a raw 3421s"));
answer([401, { error: "Not signed in" }]);
await rejects(() => ec.submitCode("111111"), (e) => {
  assert.equal(e.code, "signed_out");
  assert.equal(e.message, ec.SIGNED_OUT_MESSAGE);
});
answer(new TypeError("Failed to fetch"));
await rejects(() => ec.submitCode("111111"), (e) => {
  assert.equal(e.code, "network");
  assert.equal(e.message, ec.NETWORK_MESSAGE);
});
answer([409, { error: "email_taken", message: "That email is already in use" }]);
await rejects(() => ec.submitCode("111111"), (e) => assert.equal(e.code, "email_taken"));

// --- POST: a new code / Change Email -----------------------------------------

answer([200, { ok: true, sent: true, emailCodeExpiresAt: 1_800_000_000_000, cooldownSeconds: 30, user: walledUser }]);
const sent = await ec.requestCode();
assert.deepEqual(bodyOf(), {}, "Send a New Code sends no address");
assert.equal(sent.kind, "sent");
assert.equal(sent.expiresAt, 1_800_000_000_000);
assert.equal(sent.cooldownSeconds, 30);
assert.equal(sent.pendingEmail, null);

answer([200, { ok: true, sent: true, emailCodeExpiresAt: 1_800_000_000_000, cooldownSeconds: 30, pendingEmail: "new@example.com", user: openUser }]);
assert.equal((await ec.requestCode()).pendingEmail, "new@example.com", "an established account's change waiting");

answer([200, { ok: true, sent: true, emailCodeExpiresAt: 1_800_000_000_000, cooldownSeconds: 30, user: { ...walledUser, email: "fixed@example.com" } }]);
const changed = await ec.requestCode("fixed@example.com");
assert.deepEqual(bodyOf(), { email: "fixed@example.com" });
assert.equal(changed.user.email, "fixed@example.com", "the screen follows the address on file");

answer([200, { ok: true, sent: false, released: true, user: openUser }]);
assert.equal((await ec.requestCode()).kind, "released", "our mail is down: the wall lifts");
answer([200, { ok: true, alreadyConfirmed: true, user: openUser }]);
assert.equal((await ec.requestCode()).kind, "confirmed", "a stale screen just clears");

answer([400, { error: "recipient_refused", message: "That address didn't accept our email. Check it and tap Change Email.", user: { ...walledUser, email: "typo@exmaple.com" } }]);
await rejects(() => ec.requestCode(), (e) => {
  assert.equal(e.code, "recipient_refused");
  assert.equal(e.user.email, "typo@exmaple.com", "the typo screen shows the address on file, not a stale one");
});
for (const [status, code] of [[400, "invalid_email"], [400, "disposable_email"], [409, "email_taken"], [400, "use_account"], [503, "mail_unavailable"]]) {
  answer([status, { error: code, message: `msg ${code}` }]);
  await rejects(() => ec.requestCode("x@example.com"), (e) => {
    assert.equal(e.code, code);
    assert.equal(e.message, `msg ${code}`);
    assert.equal(e.status, status);
  });
}

// --- the link page -----------------------------------------------------------

for (const state of ["valid", "confirmed", "replaced", "expired"]) {
  answer([200, { state, email: "s***@example.com" }]);
  assert.deepEqual(await ec.peekConfirmLink("tok en"), { state, email: "s***@example.com" });
  assert.match(calls[0].url, /confirm-email\?t=tok%20en$/, "the token is URL-encoded");
  assert.equal(calls[0].init.method, undefined, "opening the page only looks: a GET, never a confirm");
}
answer([200, { state: "surprise", email: null }]);
assert.equal((await ec.peekConfirmLink("t")).state, "expired", "an unknown state reads as expired");
answer([429, { error: "Too many requests — try again in 30s", retryAfterSeconds: 30 }]);
await rejects(() => ec.peekConfirmLink("t"), (e) => assert.equal(e.message, "Wait 30 seconds, then try again."));

answer([200, { ok: true, state: "confirmed", already: false, email: "s***@example.com" }]);
assert.deepEqual(await ec.confirmLink("abc"), { already: false, email: "s***@example.com", signedIn: false });
// (10-05) a fresh confirmation signs the browser in; the page then goes straight to /app.
answer([200, { ok: true, state: "confirmed", already: false, email: "s***@example.com", signedIn: true }]);
assert.equal((await ec.confirmLink("abc")).signedIn, true, "signedIn is read from the answer");
assert.deepEqual(bodyOf(), { t: "abc" });
answer([200, { ok: true, state: "confirmed", already: true, email: "s***@example.com" }]);
assert.equal((await ec.confirmLink("abc")).already, true);
for (const [status, error, state] of [[400, "replaced", "replaced"], [400, "expired", "expired"], [409, "email_taken", "taken"]]) {
  answer([status, { error, state, message: `msg ${error}` }]);
  await rejects(() => ec.confirmLink("abc"), (e) => {
    assert.equal(e.code, error);
    assert.equal(e.message, `msg ${error}`);
  });
}

// --- the account page (PATCH /api/account) ------------------------------------

answer([200, { ok: true, user: openUser, pendingEmail: "new@example.com", emailCodeExpiresAt: 1_800_000_000_000 }]);
const change = await ec.changeAccountEmail({ email: "new@example.com", currentPassword: "hunter22hunter", name: "Sam S" });
assert.deepEqual(bodyOf(), { email: "new@example.com", currentPassword: "hunter22hunter", name: "Sam S" });
assert.equal(change.pendingEmail, "new@example.com");
assert.equal(change.emailCodeExpiresAt, 1_800_000_000_000);

answer([200, { ok: true, user: { ...walledUser, email: "new@example.com" }, emailSent: true, released: false }]);
const walledChange = await ec.changeAccountEmail({ email: "new@example.com" });
assert.deepEqual(bodyOf(), { email: "new@example.com" }, "a walled account sends no password");
assert.equal(walledChange.emailSent, true);
assert.equal(walledChange.pendingEmail, null);

answer([200, { ok: true, user: openUser }]);
const plain = await ec.changeAccountEmail({ email: "new@example.com", currentPassword: "hunter22hunter" });
assert.equal(plain.pendingEmail, null, "confirmation off: written at once, no code box");

answer([400, { error: "Current password is incorrect" }]);
await rejects(() => ec.changeAccountEmail({ email: "new@example.com", currentPassword: "nope" }), (e) => assert.equal(e.message, "Current password is incorrect"));
answer([409, { error: "That email is already in use" }]);
await rejects(() => ec.changeAccountEmail({ email: "taken@example.com", currentPassword: "x" }), (e) => assert.equal(e.message, "That email is already in use"));
answer([400, { error: "That address didn't accept our email. Check it and try again.", code: "recipient_refused" }]);
await rejects(() => ec.changeAccountEmail({ email: "typo@x.co", currentPassword: "x" }), (e) => assert.equal(e.code, "recipient_refused"));
answer([503, { error: "We couldn't send the email. Try again in a few minutes.", code: "mail_unavailable" }]);
await rejects(() => ec.changeAccountEmail({ email: "a@example.com", currentPassword: "x" }), (e) => assert.equal(e.code, "mail_unavailable"));
answer([429, { error: "slow_down", message: "Wait 24 seconds, then try again.", retryAfterSeconds: 24 }]);
await rejects(() => ec.changeAccountEmail({ email: "a@example.com", currentPassword: "x" }), (e) => {
  assert.equal(e.message, "Wait 24 seconds, then try again.");
  assert.equal(e.code, "slow_down");
});

// --- signup() and checkout ---------------------------------------------------

answer([201, { user: walledUser, emailSent: true, emailProblem: null }]);
let result = await signup("Sam Seller", "sam@example.com", "hunter22hunter");
assert.equal(result.user.mustConfirmEmail, true);
assert.equal(result.emailSent, true);
assert.equal(result.emailProblem, null);
assert.equal(result.resumed, false);

answer([201, { user: { ...walledUser, emailCodeExpiresAt: undefined }, emailSent: false, emailProblem: "recipient" }]);
result = await signup("Sam Seller", "typo@exmaple.com", "hunter22hunter");
assert.equal(result.emailProblem, "recipient");
assert.equal(result.emailSent, false);

answer([200, { user: walledUser, emailSent: true, emailProblem: null, resumed: true }]);
assert.equal((await signup("Sam Seller", "sam@example.com", "hunter22hunter")).resumed, true);

answer([201, { user: openUser, emailSent: false }]);
result = await signup("Sam Seller", "sam@example.com", "hunter22hunter");
assert.equal(result.user.mustConfirmEmail, false, "switch off: exactly today's signup");
assert.equal(result.emailSent, false);

answer([409, { error: "An account with that email already exists." }]);
await rejects(() => signup("Sam", "sam@example.com", "x"), (e) => assert.equal(e.message, "An account with that email already exists."));
answer([429, { error: "slow_down", message: "Wait 12 seconds, then try again.", retryAfterSeconds: 12 }]);
await rejects(() => signup("Sam", "sam@example.com", "x"), (e) => assert.equal(e.message, "Wait 12 seconds, then try again.", "a code limit shows its message, never 'slow_down'"));
answer([429, { error: "Too many requests — try again in 30s", retryAfterSeconds: 30 }]);
await rejects(() => signup("Sam", "sam@example.com", "x"), (e) => assert.equal(e.message, "Too many requests — try again in 30s"));

answer([403, { error: "Confirm your email first, then you can subscribe.", verifyEmail: true }]);
assert.equal(await startCheckout("standard"), "/app", "a walled account is sent to the wall, not left on a red error");
answer([200, { url: "https://checkout.stripe.test/x" }]);
assert.equal(await startCheckout("pack"), "https://checkout.stripe.test/x");
answer([403, { error: "Some other refusal" }]);
await rejects(() => startCheckout("pro"), (e) => assert.equal(e.message, "Some other refusal"));

// --- source guards: the plan review's UI findings ----------------------------

const panel = read("src/components/ConfirmEmailPanel.tsx");
assert.doesNotMatch(panel, /from "@\/components\/SessionProvider"|useSession\(|useOptionalSession\(/, "the shared panel is provider-agnostic: the signup page has no SessionProvider");
assert.doesNotMatch(panel, /maxLength=/,"a maxLength would cut a pasted '482 913' before the digit strip");
assert.match(panel, /autoComplete="one-time-code"/);
assert.match(panel, /inputMode="numeric"/);

const signupPage = read("src/app/signup/page.tsx");
assert.doesNotMatch(signupPage, /\b5 (free )?scans|\b5 free\b/i, "the free-scan count comes from pricing.ts / the confirmed user, never a literal 5");
assert.match(signupPage, /trialScansLeft/, "the You're-in step reads the confirmed user's trial count");
assert.match(signupPage, /SCANS\.trial/);

const gate = read("src/components/SubscriptionGate.tsx");
assert.match(gate, /OPEN_PATHS = \["\/app\/account", "\/app\/help", "\/app\/collection"\]/, "the open pages are unchanged");
assert.match(gate, /mustConfirmEmail/);

const header = read("src/components/AppHeader.tsx");
assert.match(header, /!user\.mustConfirmEmail && <ScanCounter/, "no scan counter behind the wall");

for (const file of ["src/lib/client/visionApi.ts"]) {
  assert.match(read(file), /status === 403 && data\?\.verifyEmail/, `${file} treats 403 verifyEmail like the quota refusal`);
}

// review fixes ------------------------------------------------------------
const has = (source, text) => source.includes(text);
const account = read("src/app/app/account/page.tsx");
assert.ok(has(account, "onCancel={pickDifferentEmail}"), "a mistyped new address has a way out of the code box");
assert.ok(has(account, "changeLanded(next, pendingChange)"), "'Email changed' only when the address moved");
assert.ok(has(account, "That code ran out, so your email didn't change"));
assert.ok(has(account, '"Confirm your email to start scanning. Plans open up right after."'), "the Plan row of a walled account offers no purchase");
assert.ok(has(account, "walled ? null : subscribed"), "...no Subscribe or Scan Pack buttons");
assert.ok(has(panel, "Use a Different Email"));
assert.doesNotMatch(panel, />\s*Close\s*</, "the change box's exit is not a bare Close");
assert.ok(
  has(panel, "disabled={busy !== null || changeCooling || !newEmail.trim()}"),
  "the Change Email form counts down only what the server said, not the resend gap it never enforced",
);
assert.ok(
  has(signupPage, "confirmFlow ? (account?.trialScansLeft ?? 0) : PRICING.trial.scans"),
  "switch off: the You're-in screen is the old one, from the pricing constant",
);
assert.ok(has(signupPage, 'scansLeft === 1 ? "scan is"'), "one free scan reads in the singular");
const helpPanel = read("src/components/HelpPanel.tsx");
assert.ok(has(helpPanel, "useOptionalSession()?.user") && has(helpPanel, "sessionUser?.mustConfirmEmail"), "help reads the unconfirmed flag from the session");
for (const promise of ["and in your email", "to your email", "You get an email"]) {
  const at = helpPanel.indexOf(promise);
  assert.ok(at > 0, `"${promise}" is still offered to accounts that get mail`);
  assert.ok(has(helpPanel.slice(Math.max(0, at - 220), at + 80), "emailPending"), `"${promise}" is branched on an unconfirmed account`);
}
assert.ok(
  has(read("src/lib/server/helpChat.ts"), 'needsEmailConfirm(user) ? "here" : "to your email"'),
  "the robot promises no email reply to an unconfirmed account",
);

const spec = read("e2e/mobile.spec.ts");
assert.match(spec, /"\/help", "\/confirm-email"\]/, "the anonymous phone-width loop covers /confirm-email");

const linkPage = read("src/app/confirm-email/page.tsx");
// The layout takes its metadata from lib/pageMeta.ts PRIVATE_META (09-30 SEO sweep): check the wiring and the noindex itself.
assert.match(read("src/app/confirm-email/layout.tsx"), /PRIVATE_META\.confirmEmail/, "the link page takes the private metadata");
assert.equal((await import(new URL("../src/lib/pageMeta.ts", import.meta.url).href)).PRIVATE_META.confirmEmail.robots.index, false, "the link page is noindex");
// Opening the page must only peek: confirmLink (the POST) is called from the button handler alone.
assert.equal((linkPage.match(/confirmLink\(/g) ?? []).length, 1, "exactly one caller of the POST");
assert.match(linkPage, /async function confirm\(\)[\s\S]*?confirmLink\(token\)/);

// (10-05) link-only signup/wall: no code box outside change mode, the button says what it does, and a fresh confirmation goes to /app.
assert.match(panel, /const linkOnly = mode !== "change"/, "signup and wall are link-only");
assert.match(panel, /showCodeForm = canResend && !linkOnly/, "the code box is the email change's alone");
assert.match(panel, /We sent a link to[\s\S]*Open it and tap Confirm\./, "the link-only line");
assert.match(panel, /Send a new link/, "resend is Send a new link");
assert.match(linkPage, /Confirm and open CardFlip/, "the page button");
assert.match(linkPage, /out\.signedIn[\s\S]*router\.replace\("\/app\?scan=1"\)/, "a signed-in confirmation goes straight to the open scanner");
assert.match(linkPage, /peek\.state === "valid" \|\| peek\.state === "confirmed"\) void confirm\(\)/, "the link confirms as the page opens, no tap");
assert.match(panel, /pushPendingScan/, "the waiting scan is parked on the server when the screen comes up");

console.log("email confirm UI: ok");
