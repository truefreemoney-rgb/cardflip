/**
 * Scan rollover, the words and the screens (Chris, 09-30: scans no longer reset
 * on the 1st; each paid invoice adds the plan's scans and unused scans stack).
 * No browser, no server. Run: npm run test:rollovercopy
 *
 * Pins:
 *  - the copy: no customer-facing string in src/ promises a reset ("don't roll
 *    over", "resets at the start", "reset each billing month", "this month",
 *    "monthly allowance", "calendar month"...). Comments are ignored; a genuine
 *    Eastern-day counter for legacy accounts is not one of these phrases;
 *  - one wording: ROLLOVER_SENTENCE / FROZEN_SENTENCE come from lib/pricing.ts and
 *    the pricing page, Terms, the help article, the welcome mail, the paywall and
 *    the account page all use them (nothing retypes the promise);
 *  - lib/scanCopy.ts: the header tooltip, the "Plan ends" line, the paused
 *    balance, the out-of-scans sentence, all in Eastern dates and plain words,
 *    for a subscriber, an ending plan, a canceled account and comped/trial/legacy;
 *  - the screens are wired to the one shared ScanQuota type (no inline copies), the
 *    welcome page and the account page wait for scans to land, the header drops
 *    "/ 250" for subscribers only, the admin table shows plan scans left and has
 *    the owner's Adjust Scans control.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const has = (s, needle) => s.includes(needle);

const { ROLLOVER_SENTENCE, FROZEN_SENTENCE, DRAW_ORDER_SENTENCE, SCANS } = await import(at("lib/pricing.ts"));
const copy = await import(at("lib/scanCopy.ts"));
const { helpArticles } = await import(at("lib/helpArticles.ts"));

// --- 1. no reset promise anywhere in src -----------------------------------------

const BANNED = [
  /don['’]?t roll over/i,
  /do not roll over/i,
  /resets? at the (start|beginning)/i,
  /resets? on the (first|1st)/i,
  /reset each (billing )?month/i,
  /resets? every (billing )?month/i,
  /the (first|1st) of (each|the next|every) month/i,
  /(?<![\w-])this month(?![\w-])/i,
  /next month['’]?s? (allowance|scans)/i,
  /monthly allowance/i,
  /month['’]s allowance/i,
  /calendar month/i,
  /scans? per (calendar )?month/i,
  /used this period/i,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Code with comments blanked (keeps line numbers), so only strings and JSX text are judged. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? "" : line.replace(/\s\/\/\s.*$/, "")))
    .join("\n");
}

const srcDir = fileURLToPath(new URL("src/", root));
const found = [];
for (const file of walk(srcDir)) {
  const lines = stripComments(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    for (const re of BANNED) if (re.test(line)) found.push(`${path.relative(srcDir, file)}:${i + 1} ${re} :: ${line.trim().slice(0, 100)}`);
  });
}
assert.deepEqual(found, [], `customer-facing copy still promises a reset:\n${found.join("\n")}`);

// --- 2. one wording, used where the promise is made -------------------------------

assert.equal(ROLLOVER_SENTENCE, "Unused scans carry over each month while your plan is active.");
assert.match(FROZEN_SENTENCE, /pause/);
assert.match(FROZEN_SENTENCE, /resubscribe/);
assert.match(DRAW_ORDER_SENTENCE, /plan scans first.*bonus.*Scan Pack/);

for (const file of ["src/app/pricing/page.tsx", "src/app/terms/page.tsx", "src/lib/helpArticles.ts", "src/lib/server/mail.ts", "src/components/Paywall.tsx", "src/app/app/account/page.tsx", "src/app/app/account/welcome/page.tsx"]) {
  assert.ok(has(read(file), "ROLLOVER_SENTENCE"), `${file} says the rollover rule from lib/pricing.ts`);
}
for (const file of ["src/app/pricing/page.tsx", "src/app/terms/page.tsx", "src/lib/helpArticles.ts", "src/lib/server/mail.ts", "src/app/app/account/page.tsx"]) {
  assert.ok(has(read(file), "FROZEN_SENTENCE"), `${file} says what a canceled plan does to banked scans`);
}
const scanLimits = helpArticles.find((a) => a.id === "scan-limits");
assert.ok(scanLimits, "the scan-limits help article exists (the 402 banner links to it)");
const limitsText = scanLimits.paragraphs.join(" ");
assert.ok(has(limitsText, ROLLOVER_SENTENCE) && has(limitsText, FROZEN_SENTENCE), "the help article carries both sentences (the help bot reads it)");
assert.ok(has(limitsText, `adds ${SCANS.standard} scans`), "the help article names what a payment adds, from pricing.ts");

// The help bot's account facts never print a meaningless per-period counter for a subscriber.
const helpChat = read("src/lib/server/helpChat.ts");
assert.ok(!has(helpChat, "scansUsed"), "the help bot is not told scansUsed");
assert.ok(has(helpChat, "Plan scans left") && has(helpChat, "spendsPlanScans(user)"), "the help bot gets the plan balance, carried scans and next credit");

// --- 3. lib/scanCopy.ts ----------------------------------------------------------

// Oct 26 02:00 UTC is still Oct 25 in Eastern: the date must follow the Eastern day, not the server's.
const OCT_25 = Date.UTC(2026, 9, 26, 2, 0, 0);
const sub = { used: 0, included: 250, remaining: 488, bonus: 0, pack: 0, plan: 488, carried: 238, lastCredit: 250, lastCreditAt: 1, nextCreditAt: OCT_25, endsAt: null };

assert.equal(copy.shortDate(OCT_25), "Oct 25", "dates are Eastern");
assert.equal(copy.shortDate(null), "");

let title = copy.scanCounterTitle(sub, "subscribed");
assert.equal(title, "488 scans left, 238 carried over. Your next scans arrive on Oct 25 — tap for more scans");
assert.ok(!/ of 250|\/ 250|this month/.test(title), "no '/ 250' for a subscriber");

title = copy.scanCounterTitle({ ...sub, remaining: 588, bonus: 40, pack: 60 }, "subscribed");
assert.match(title, /^588 scans left, 238 carried over, 40 bonus, 60 in your Scan Pack\./);

// Plan set to cancel: no promise of a credit that will not come, and the pause is named.
const ending = { ...sub, remaining: 238, plan: 238, carried: 0, nextCreditAt: null, endsAt: OCT_25 };
title = copy.scanCounterTitle(ending, "subscribed");
assert.ok(!/next 250|arrive/i.test(title), "an ending plan promises no next credit");
assert.match(title, /Plan ends Oct 25; 238 banked scans pause until you resubscribe/);
assert.equal(copy.planEndsSentence(ending), "Plan ends Oct 25; 238 banked scans pause until you resubscribe");
assert.equal(copy.planEndsSentence({ ...ending, plan: 1 }), "Plan ends Oct 25; 1 banked scan pauses until you resubscribe");
assert.equal(copy.planEndsSentence({ ...ending, plan: 0 }), "Plan ends Oct 25");
assert.equal(copy.planEndsSentence(sub), null, "a plan that is not ending has no end line");
assert.equal(copy.nextCreditSentence(ending), null);
assert.equal(copy.nextCreditSentence({ ...sub, nextCreditAt: null }), null, "a failed payment (no next date) promises nothing");

// Out of scans: the next date, or a Scan Pack.
const out = { ...sub, remaining: 0, plan: 0, carried: 0 };
assert.equal(copy.scanCounterTitle(out, "subscribed"), "No scans left. Your next scans arrive on Oct 25, or tap to add a Scan Pack");
assert.equal(copy.scanCounterTitle({ ...out, nextCreditAt: null }, "subscribed"), "No scans left. Tap to add a Scan Pack");
assert.equal(copy.moreScansSentence(out, "subscribed"), "Your next scans arrive on Oct 25, or add a Scan Pack to keep scanning now.");
assert.equal(copy.moreScansSentence({ ...out, nextCreditAt: null }, "subscribed"), "Add a Scan Pack to keep scanning.");

// Canceled: banked scans are paused, not lost, and the wording says so.
const canceled = { used: 5, included: 5, remaining: 0, frozen: 388 };
assert.equal(copy.frozenSentence(canceled), "388 banked plan scans are paused and come back when you resubscribe");
assert.equal(copy.frozenSentence({ ...canceled, frozen: 1 }), "1 banked plan scan is paused and comes back when you resubscribe");
assert.equal(copy.frozenSentence({ used: 5, included: 5, remaining: 0 }), null);
assert.match(copy.scanCounterTitle(canceled, "trial"), /^No scans left on the free trial\. 388 banked plan scans are paused and come back when you resubscribe — get more$/);
assert.match(copy.moreScansSentence(canceled, "trial"), /^388 banked plan scans are paused and come back when you resubscribe\. A Scan Pack works right away\.$/);
assert.equal(copy.moreScansSentence({ used: 5, included: 5, remaining: 0 }, "trial"), "Subscribe or add a Scan Pack to keep scanning.");

// Trial and legacy keep their own words ("3 of 5 free", "80 of 100 today"); pack stays "in your pack".
assert.equal(copy.scanCounterTitle({ used: 2, included: 5, remaining: 3 }, "trial"), "3 of 5 free scans left — tap for more scans");
assert.equal(copy.scanCounterTitle({ used: 20, included: 100, remaining: 80 }, "legacy"), "80 of 100 today left — tap for more scans");
assert.equal(copy.scanCounterTitle({ used: 0, included: 100, remaining: 100, pack: 100 }, "pack"), "100 of 100 in your pack left — tap for more scans");

// A comped account (calendar counter, no plan balance) is a subscriber for display: no "/ 250", no invented dates.
const comped = { used: 12, included: 250, remaining: 238, bonus: 0, pack: 0 };
title = copy.scanCounterTitle(comped, "subscribed");
assert.equal(title, "238 scans left — tap for more scans");
assert.equal(copy.hasPlanBalance(comped), false);
assert.equal(copy.hasPlanBalance(sub), true);

// hasScansToUse: the welcome page and the account poll gate on it.
assert.equal(copy.hasScansToUse(undefined), false, "no snapshot yet is not ready");
assert.equal(copy.hasScansToUse({ used: 0, included: 250, remaining: 0 }), false, "status flipped but no scans credited yet is not ready");
assert.equal(copy.hasScansToUse({ used: 0, included: 250, remaining: 250 }), true);
assert.equal(copy.hasScansToUse({ used: 4, included: 0, remaining: null }), true, "an unlimited account is ready");

// --- 4. the screens are wired -------------------------------------------------------

const counter = read("src/components/ScanCounter.tsx");
assert.ok(has(counter, "scanCounterTitle(scans, user.tier)"), "the header tooltip comes from scanCopy");
assert.ok(has(counter, 'user.tier === "subscribed"'), "only subscribers drop the '/ N'");
assert.ok(has(counter, "Get More Scans") && !has(counter, "Get more scans"), "the out state is Title Case");
assert.ok(has(counter, "paused"), "a canceled account's banked scans show in the header");
assert.ok(!has(counter, "this month"));

// One type: no inline copies of the quota shape.
assert.ok(!/quota\?: \{/.test(read("src/lib/client/accountApi.ts")) && has(read("src/lib/client/accountApi.ts"), "quota?: ScanQuota"));
assert.ok(has(read("src/lib/client/visionApi.ts"), "export type ScanUsage = ScanQuota;"));
assert.ok(!/quota\?: \{/.test(read("src/app/app/account/page.tsx")) && has(read("src/app/app/account/page.tsx"), "quota?: ScanQuota"));
assert.ok(has(read("src/lib/client/auth.ts"), "scans?: ScanQuota;"));

const welcome = read("src/app/app/account/welcome/page.tsx");
assert.ok(/paymentCredited\(o\?\.quota \?\? o\?\.user\.scans, since\)/.test(welcome), "the welcome page waits for the payment's credit, not just for any spendable scans");
assert.ok(!has(welcome, "SCANS.standard") && !has(welcome, "SCANS.pro"), "the welcome page never prints a count the server did not send");
assert.ok(has(welcome, "Scan a Card") && has(welcome, "Manage Billing"), "welcome buttons are Title Case");
const account = read("src/app/app/account/page.tsx");
assert.ok(has(account, "paymentCredited(o.quota ?? o.user.scans, since)"), "the account page's confirmed phase waits for the payment's credit too");
// The rollover promise is only made to a real rollover subscriber, never to an override account.
assert.ok(/\{rollover && \(\s*<p className="mt-3 text-xs text-zinc-600">\s*\{ROLLOVER_SENTENCE\}/.test(account), "the account page's rollover sentence is gated on hasPlanBalance");
assert.ok(has(account, "Unlimited scans"), "an unlimited account reads 'Unlimited scans', not 0");
assert.ok(!has(account, "Next {q.included"), "the next credit promises a date, not a count");
assert.ok(has(account, "planEndsSentence(q)") && has(account, "frozenSentence(q)"), "the account page shows the ending plan and the paused balance");
assert.ok(!/\/ quota\.included|\/ q\.included|\.included\) \* 100/.test(account), "no bar divides by included any more");
assert.ok(has(account, "Cancel Plan") && !has(account, ">Cancel plan<"));

const paywall = read("src/components/Paywall.tsx");
assert.ok(has(paywall, "user?.scans?.frozen"), "the wall names the paused balance");

const users = read("src/components/admin/AdminUsersTable.tsx");
assert.ok(has(users, "plan scans left") && has(users, "AdjustScansControl"), "the admin table shows plan scans left and has the Adjust Scans control");
assert.ok(has(read("src/app/admin/(console)/users/page.tsx"), "planScans: planScansLeft(u)"), "the admin page passes plan scans");
const adjust = read("src/components/admin/AdjustScansControl.tsx");
assert.ok(has(adjust, "/api/admin/users/${userId}/scans") && has(adjust, "Adjust Scans") && has(adjust, " text-base ") && has(adjust, "sm:text-sm"), "the control posts to the owner endpoint, Title Case, inputs >= 16px on phones");

// The Adjust Scans control never needs a minus key: Add / Take Back is a toggle (iOS numeric keypad has none).
assert.ok(has(adjust, "Take Back") && has(adjust, 'pattern="[0-9]*"') && !has(adjust, "-250"), "adjust: a Take Back toggle, digits only, no '-250' typed");

// paymentCredited: the welcome page and the account poll wait for THIS payment's plan credit.
const since = 1_000_000;
assert.equal(copy.paymentCredited(undefined, since), false);
assert.equal(copy.paymentCredited({ ...sub, plan: 0, remaining: 100, pack: 100, lastCreditAt: null }, since), false, "Scan Pack scans alone do not confirm a subscription payment");
assert.equal(copy.paymentCredited({ ...sub, plan: 238, remaining: 238, lastCreditAt: since - 1 }, since), false, "a paused balance that unfroze, with an old credit, does not confirm it");
assert.equal(copy.paymentCredited({ ...sub, lastCreditAt: since }, since), true, "a plan credit written since the checkout confirms it");
assert.equal(copy.paymentCredited(comped, since), true, "a comped account (no plan balance) falls back to 'has scans'");
assert.equal(copy.paymentCredited({ used: 0, included: 0, remaining: null }, since), true, "an unlimited account is ready");

// The next credit names a date, never a count (a downgrade at period end changes the amount).
assert.ok(!/\d/.test(copy.nextCreditSentence(sub).replace("Oct 25", "")), "no scan count in the next-credit sentence");

console.log("rollover copy: ok");
