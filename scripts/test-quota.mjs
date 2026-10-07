/**
 * Scan metering + cron gate — the two small server libs money rides on:
 * scanQuota meters the balance (a subscriber's plan scans are credited by
 * paid invoices, PLAN_SCANS from lib/pricing.ts), and cronAuthError is the
 * only thing between the internet and the daily jobs.
 * Run: npm run test:quota
 *
 * Pins: quota is only ENFORCED for subscribers (remaining null otherwise)
 * but METERED for everyone; scan ROLLOVER (09-30): a payment adds the plan's
 * scans, unused scans stack, the calendar month changes nothing, a scan is
 * RESERVED atomically before the paid work (two in flight with one left: one
 * wins) and given back when the read fails, draw order plan -> bonus -> Scan
 * Pack, comped/legacy/trial/owner/pack-only keep their own counters, cancel
 * pauses the banked plan scans and resubscribe brings them back, the lazy
 * seed keeps deploy day from walling a subscriber; grace statuses counting as
 * subscribed; and the cron gate's three answers — 503 unconfigured, 403
 * wrong/missing key, pass on either ?key= or a Bearer header.
 *
 * Same throwaway-db trick as test-auth.mjs: chdir to a temp dir before any
 * import so `data/cardflip.db` lands there.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-quota-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { MONTHLY_SCANS, giveBackScans, reserveScan, reserveScans, scanQuota, scanQuotaExhausted } = await import(at("lib/server/scanQuota.ts"));
const { cronAuthError } = await import(at("lib/server/cronAuth.ts"));
const { createUser, findUserById, LEGACY_DAILY_SCANS, OWNER_EMAIL, PAID_SWITCH_AT, PLAN_SCANS, TRIAL_SCANS, toPublicUser } = await import(at("lib/server/users.ts"));
const { db } = await import(at("lib/db.ts"));
const { NextRequest } = await import("next/server");

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const thisMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
const base = await createUser("Q", "quota@example.com", "hunter22");
// Tiers (09-04): owner (unlimited) / subscribed (monthly cap) / legacy
// (created before the paid switch: 100 a day) / trial (10 lifetime).
const legacy = (over) => ({ ...base, createdAt: PAID_SWITCH_AT - 1, scanMonth: today, ...over });
const fresh = (over) => ({ ...base, createdAt: PAID_SWITCH_AT + 1, scanMonth: thisMonth, ...over });
// A real subscriber: a live Stripe status and a plan balance (planScans null = not migrated yet).
const sub = (over) => fresh({ subStatus: "active", planScans: PLAN_SCANS.standard, ...over });
const owner = (over) => fresh({ email: OWNER_EMAIL, ...over });

// --- scanQuota per tier ------------------------------------------------------
check("legacy account: 100 a day, metered by day",
  scanQuota(legacy({ subStatus: null, scansUsed: 40 })),
  { used: 40, included: LEGACY_DAILY_SCANS, remaining: LEGACY_DAILY_SCANS - 40 });
check("legacy account: yesterday's count reads as zero",
  scanQuota(legacy({ subStatus: null, scanMonth: "2020-01-01", scansUsed: 99 })).used, 0);
check("legacy canceled subscriber falls back to the daily cap",
  scanQuota(legacy({ subStatus: "canceled", scansUsed: 1 })).remaining, LEGACY_DAILY_SCANS - 1);
check("fresh account: 5-scan trial, lifetime",
  scanQuota(fresh({ subStatus: null, trialScansUsed: 4 })),
  { used: 4, included: TRIAL_SCANS, remaining: TRIAL_SCANS - 4 });
check("owner: never enforced",
  scanQuota(owner({ subStatus: null, scansUsed: 5000 })).remaining, null);
check("active subscriber: remaining = the plan balance",
  scanQuota(sub({ planScans: 238 })).remaining, 238);
check("trialing and past_due count as subscribed (banked scans keep working)",
  ["trialing", "past_due"].map((st) => scanQuota(sub({ subStatus: st, planScans: 99 })).remaining),
  [99, 99]);
check("pro subscriber: the balance is the balance, `included` is what one Pro payment credits",
  [scanQuota(sub({ plan: "pro", planScans: 700 })).remaining, scanQuota(sub({ plan: "pro", planScans: 700 })).included], [700, PLAN_SCANS.pro]);
check("the calendar month means nothing to a subscriber: stale, current and null scan_month read the same",
  [{ scanMonth: "2020-01", scansUsed: 499 }, { scanMonth: thisMonth, scansUsed: 3 }, { scanMonth: null, scansUsed: 7 }].map((o) => scanQuota(sub({ planScans: 238, ...o })).remaining),
  [238, 238, 238]);
check("subscriber snapshot shape: balance, carried over, next credit, end date",
  scanQuota(sub({ planScans: 488, planCreditScans: 250, planCreditAt: 1_700_000_000_000, subPeriodEnd: 1_800_000_000_000, bonusScans: 2, extraScans: 3 })),
  { used: 0, included: MONTHLY_SCANS, remaining: 493, bonus: 2, pack: 3, plan: 488, carried: 238, lastCredit: 250, lastCreditAt: 1_700_000_000_000, nextCreditAt: 1_800_000_000_000, endsAt: null });
check("a plan set to cancel: no next credit, an end date instead",
  (({ nextCreditAt, endsAt }) => [nextCreditAt, endsAt])(scanQuota(sub({ subPeriodEnd: 1_800_000_000_000, subCancelAt: 1_800_000_000_000 }))), [null, 1_800_000_000_000]);
check("past_due: no next credit date promised",
  scanQuota(sub({ subStatus: "past_due", subPeriodEnd: 1_800_000_000_000 })).nextCreditAt, null);
check("remaining clamps at zero: a negative balance never shows",
  scanQuota(sub({ planScans: -5 })).remaining, 0);

// --- admin plan overrides (09-04) + the selling gate ---------------------------
const { scanTier, planOf, isComped, canUseApp } = await import(at("lib/server/users.ts"));
const { sellingGate, subscriptionGate } = await import(at("lib/server/auth.ts"));
check("override: unlimited reads as owner, never enforced",
  [scanTier(fresh({ accessOverride: "unlimited" })), scanQuota(fresh({ accessOverride: "unlimited", scansUsed: 9999 })).remaining],
  ["owner", null]);
check("override: comp_standard = subscribed at the plan cap with no Stripe status",
  [scanTier(fresh({ accessOverride: "comp_standard" })), scanQuota(fresh({ accessOverride: "comp_standard", scansUsed: 20 })).remaining],
  ["subscribed", MONTHLY_SCANS - 20]);
check("override: comp_pro = Pro cap, planOf pro even with plan null",
  [planOf(fresh({ accessOverride: "comp_pro", plan: null })), scanQuota(fresh({ accessOverride: "comp_pro", scansUsed: 1 })).remaining],
  ["pro", PLAN_SCANS.pro - 1]);
check("override: isComped only for the comp values",
  ["comp_standard", "comp_pro", "unlimited", "legacy", "trial", null].map((v) => isComped(fresh({ accessOverride: v }))),
  [true, true, false, false, false, false]);
check("override: legacy on a fresh account = 100 a day",
  scanQuota(fresh({ accessOverride: "legacy", scanMonth: today, scansUsed: 2 })).remaining, LEGACY_DAILY_SCANS - 2);
check("override: trial on a subscriber beats the subscription",
  scanTier(sub({ accessOverride: "trial" })), "trial");
check("override: an admin forced to trial is still trial (override wins)",
  scanTier(fresh({ role: "admin", accessOverride: "trial" })), "trial");
check("canUseApp: trial with scans left yes, exhausted no, comped yes",
  [canUseApp(fresh({ trialScansUsed: 3 })), canUseApp(fresh({ trialScansUsed: TRIAL_SCANS })), canUseApp(fresh({ trialScansUsed: TRIAL_SCANS, accessOverride: "comp_standard" }))],
  [true, false, true]);
check("sellingGate: trial 402 even with scans left; subscriber, legacy, comped, admin pass",
  [
    sellingGate(fresh({ trialScansUsed: 0 }))?.status ?? null,
    sellingGate(sub({}))?.status ?? null,
    sellingGate(legacy({ subStatus: null }))?.status ?? null,
    sellingGate(fresh({ accessOverride: "comp_standard" }))?.status ?? null,
    sellingGate(fresh({ role: "admin" }))?.status ?? null,
  ],
  [402, null, null, null, null]);
check("subscriptionGate: trial with scans left passes, exhausted 402",
  [subscriptionGate(fresh({ trialScansUsed: 1 }))?.status ?? null, subscriptionGate(fresh({ trialScansUsed: TRIAL_SCANS }))?.status ?? null],
  [null, 402]);
check("sellingGate body flags selling, subscriptionGate body flags quota",
  [(await sellingGate(fresh({})).json()).selling === true, (await subscriptionGate(fresh({ trialScansUsed: TRIAL_SCANS })).json()).quota === true],
  [true, true]);

// --- email confirmation wall (09-30): only a trial signup that is still pending ---
{
  const { needsEmailConfirm } = await import(at("lib/server/users.ts"));
  const saved = { echo: process.env.EMAIL_CONFIRM_DEV_ECHO, host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];
  process.env.EMAIL_CONFIRM_DEV_ECHO = "1";
  const pending = (over) => fresh({ emailPending: true, trialScansUsed: 0, ...over });
  check("wall: a pending trial signup cannot use the app while a code can be delivered",
    [canUseApp(pending({})), needsEmailConfirm(pending({})), toPublicUser(pending({})).mustConfirmEmail, toPublicUser(pending({})).appAccess],
    [false, true, true, false]);
  check("wall: a pending signup with no scans used is walled, not 'out of scans'",
    [subscriptionGate(pending({}))?.status, (await subscriptionGate(pending({})).json()).verifyEmail, sellingGate(pending({}))?.status],
    [403, true, 403]);
  check("wall: subscriber, pack holder, legacy, comped, owner and admin are never walled, even flagged pending",
    [
      pending({ subStatus: "active" }),
      pending({ extraScans: 5 }),
      pending({ createdAt: PAID_SWITCH_AT - 1 }),
      pending({ accessOverride: "comp_standard" }),
      pending({ accessOverride: "unlimited" }),
      pending({ email: OWNER_EMAIL }),
      pending({ role: "admin" }),
    ].map((u) => [needsEmailConfirm(u), canUseApp(u), subscriptionGate(u)?.status ?? null]),
    Array(7).fill([false, true, null]));
  check("wall: an admin override of 'trial' on a pending signup is still the trial tier, so walled",
    needsEmailConfirm(pending({ accessOverride: "trial" })), true);
  check("wall: an ordinary account (email_pending 0) is untouched, wall or no wall",
    [needsEmailConfirm(fresh({ emailPending: false })), canUseApp(fresh({ emailPending: false, trialScansUsed: 1 })), toPublicUser(fresh({ emailPending: false })).mustConfirmEmail],
    [false, true, false]);
  delete process.env.EMAIL_CONFIRM_DEV_ECHO;
  check("wall: with no way to deliver a code (no SMTP, no dev echo) it fails open",
    [needsEmailConfirm(pending({})), canUseApp(pending({})), subscriptionGate(pending({}))],
    [false, true, null]);
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_USER: "x@y.z", SMTP_PASS: "nope" });
  check("wall: real SMTP configuration counts as a way to deliver",
    needsEmailConfirm(pending({})), true);
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];
  if (saved.echo !== undefined) process.env.EMAIL_CONFIRM_DEV_ECHO = saved.echo;
  if (saved.host !== undefined) process.env.SMTP_HOST = saved.host;
  if (saved.user !== undefined) process.env.SMTP_USER = saved.user;
  if (saved.pass !== undefined) process.env.SMTP_PASS = saved.pass;
}

check("exhausted exactly at zero plan scans",
  scanQuotaExhausted(sub({ planScans: 0 })), true);
check("one left ≠ exhausted",
  scanQuotaExhausted(sub({ planScans: 1 })), false);
check("comped account: still the calendar counter, exhausted at the cap",
  [scanQuotaExhausted(fresh({ accessOverride: "comp_standard", scansUsed: MONTHLY_SCANS })), scanQuotaExhausted(fresh({ accessOverride: "comp_standard", scansUsed: MONTHLY_SCANS - 1 }))], [true, false]);
check("trial exhausted at 10",
  scanQuotaExhausted(fresh({ subStatus: null, trialScansUsed: TRIAL_SCANS })), true);
check("legacy exhausted at 100 for the day",
  scanQuotaExhausted(legacy({ subStatus: null, scansUsed: LEGACY_DAILY_SCANS })), true);
check("owner is never exhausted",
  scanQuotaExhausted(owner({ subStatus: null, scansUsed: MONTHLY_SCANS * 2 })), false);

// --- rollover: the lazy seed, payments, reserving ---------------------------------
const { creditPlanScans } = await import(at("lib/server/scanCredits.ts"));
const { setSubscription, planSeedFor } = await import(at("lib/server/users.ts"));
const { SEED_MONTH } = await import(at("lib/planSeed.ts"));
// The seed window and the seed month are dates, so the tests that touch them pin the clock
// (Date.now only: the period keys use new Date(), which is left alone).
const realNow = Date.now;
const atTime = async (ms, fn) => {
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = realNow; }
};
const OCT_2 = Date.UTC(2026, 9, 2, 12);

let seq = 0;
/** A real subscriber row (live Stripe status, no override); `set` = raw column values. Answers the user id. */
async function mkSub(set = {}) {
  const u = await createUser("R", `roll${++seq}@example.com`, "hunter22");
  const cols = { sub_status: "active", created_at: PAID_SWITCH_AT + 1, plan: "standard", ...set };
  await db.prepare(`UPDATE users SET ${Object.keys(cols).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...Object.values(cols), u.id);
  return u.id;
}
const get = (id) => findUserById(id);
const ledger = async (id) =>
  (await db.prepare("SELECT credit_key, kind, scans, applied FROM scan_credits WHERE user_id = ? ORDER BY rowid").all(id)).map((r) => ({ key: r.credit_key, kind: r.kind, scans: r.scans, applied: r.applied }));

// Deploy day: plan_scans is NULL until first use. Nobody may see a wall or lose September's leftover.
{
  const id = await mkSub({ scan_month: SEED_MONTH, scans_used: 12 }); // 6cd43f's row: 12 of 250 used in September
  const u0 = await get(id);
  check("deploy day: a NULL balance reads as September's leftover, never zero (no 402 wall), even after the month flipped",
    await atTime(OCT_2, async () => [u0.planScans, planSeedFor(u0), scanQuota(u0).remaining, scanQuotaExhausted(u0)]), [null, PLAN_SCANS.standard - 12, PLAN_SCANS.standard - 12, false]);
  const r = await atTime(OCT_2, () => reserveScan(u0));
  check("the first scan writes the seed and spends one from it",
    [r.taken, r.usage.plan, (await get(id)).planScans], [1, PLAN_SCANS.standard - 13, PLAN_SCANS.standard - 13]);
  check("the seed is one ledger row, migration:<id>", await ledger(id), [{ key: `migration:${id}`, kind: "migration", scans: PLAN_SCANS.standard - 12, applied: PLAN_SCANS.standard - 12 }]);
  await atTime(OCT_2, async () => reserveScan(await get(id)));
  check("a second scan seeds nothing more", [(await ledger(id)).length, (await get(id)).planScans], [1, PLAN_SCANS.standard - 14]);

  const rolled = await mkSub({ scan_month: "2026-10", scans_used: 5 });
  check("a row the old code already rolled to October seeds the full allowance (the safe side)",
    await atTime(OCT_2, async () => planSeedFor(await get(rolled))), PLAN_SCANS.standard);
  const late = await mkSub({ scan_month: SEED_MONTH, scans_used: 12 });
  check("after the seed window (Nov 1) a NULL balance seeds nothing and reads 0",
    await atTime(Date.UTC(2026, 10, 5), async () => { const u = await get(late); return [planSeedFor(u), scanQuota(u).remaining]; }), [null, 0]);

  const never = {
    "override legacy": await mkSub({ access_override: "legacy" }),
    "comp_pro": await mkSub({ access_override: "comp_pro" }),
    "canceled": await mkSub({ sub_status: "canceled" }),
    "no subscription": await mkSub({ sub_status: null }),
    "admin": await mkSub({ role: "admin" }),
  };
  const seeds = {};
  for (const [name, uid] of Object.entries(never)) seeds[name] = await atTime(OCT_2, async () => planSeedFor(await get(uid)));
  check("no seed for override, comped, canceled, never-subscribed or admin accounts",
    seeds, { "override legacy": null, "comp_pro": null, "canceled": null, "no subscription": null, "admin": null });
  check("past_due still spends a balance, so it is still seeded",
    await atTime(OCT_2, async () => planSeedFor(await get(await mkSub({ sub_status: "past_due", scan_month: SEED_MONTH, scans_used: 50 })))), PLAN_SCANS.standard - 50);
}

// Payments add scans and they stack; the calendar changes nothing.
{
  const id = await mkSub({ plan_scans: 0 });
  const pay = (key, scans = PLAN_SCANS.standard) => creditPlanScans({ userId: id, key, kind: "payment", plan: "standard", scans });
  const c1 = await pay("in_1");
  check("a payment adds the plan's scans", [c1.recorded, c1.applied, (await get(id)).planScans], [true, PLAN_SCANS.standard, PLAN_SCANS.standard]);
  for (let i = 0; i < 12; i++) await reserveScan(await get(id));
  check("scans draw the balance down", (await get(id)).planScans, PLAN_SCANS.standard - 12);
  await pay("in_2");
  const q = scanQuota(await get(id));
  check("a second payment stacks on the leftover (238 + 250 = 488)",
    [q.plan, q.remaining, q.carried, q.lastCredit], [PLAN_SCANS.standard * 2 - 12, PLAN_SCANS.standard * 2 - 12, PLAN_SCANS.standard - 12, PLAN_SCANS.standard]);
  const again = await pay("in_2");
  check("the same invoice again changes nothing", [again.recorded, (await get(id)).planScans, (await ledger(id)).length], [false, PLAN_SCANS.standard * 2 - 12, 2]);
}

// Subscribe on the 28th, the calendar month flips: nothing new arrives until the next payment.
{
  const id = await mkSub({ sub_status: null, plan: null });
  const sep28 = Date.UTC(2026, 8, 28, 15);
  await creditPlanScans({ userId: id, key: "in_28th", kind: "payment", plan: "standard", scans: PLAN_SCANS.standard, now: sep28 });
  await setSubscription(id, "active", Date.UTC(2026, 9, 28), "standard");
  const before = scanQuota(await get(id)).remaining;
  const seen = [];
  for (const when of [Date.UTC(2026, 8, 30, 23, 59), Date.UTC(2026, 9, 1, 0, 1), Date.UTC(2026, 9, 2, 12)]) {
    seen.push(await atTime(when, async () => scanQuota(await get(id)).remaining));
  }
  check("the 1st comes and goes: the balance is what the payment bought, no fresh allowance", [before, ...seen], Array(4).fill(PLAN_SCANS.standard));
  check("the ledger holds the one payment", (await ledger(id)).map((r) => r.key), ["in_28th"]);
  await creditPlanScans({ userId: id, key: "in_oct28", kind: "payment", plan: "standard", scans: PLAN_SCANS.standard, now: Date.UTC(2026, 9, 28) });
  check("the next payment is what adds more", scanQuota(await get(id)).remaining, PLAN_SCANS.standard * 2);
}

// --- reserving: draw order, bulk, give-back, races ---------------------------------
{
  const id = await mkSub({ plan_scans: 2, bonus_scans: 1, extra_scans: 2 });
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const r = await reserveScan(await get(id));
    seen.push([r.taken, r.usage.plan, r.usage.bonus, r.usage.pack, r.usage.remaining]);
  }
  check("draw order: plan balance, then referral bonus, then Booster; nothing after that",
    seen, [[1, 1, 1, 2, 4], [1, 0, 1, 2, 3], [1, 0, 0, 2, 2], [1, 0, 0, 1, 1], [1, 0, 0, 0, 0], [0, 0, 0, 0, 0]]);
}
{
  const id = await mkSub({ plan_scans: 3, bonus_scans: 2, extra_scans: 5 });
  const r = await reserveScans(await get(id), 8);
  check("bulk draw (a CSV import): plan 3, then bonus 2, then 3 of the pack",
    [r.taken, r.draw.plan, r.draw.bonus, r.draw.pack, r.usage.remaining], [8, 3, 2, 3, 2]);
  const short = await reserveScans(await get(id), 5);
  check("a bulk ask past the balance takes what is left", [short.taken, short.usage.remaining], [2, 0]);
  const back = await giveBackScans(await get(id), short, 1);
  check("give-back returns the last scan taken first", [back.pack, back.plan, back.remaining], [1, 0, 1]);
  check("zero and negative asks take nothing", [(await reserveScans(await get(id), 0)).taken, (await reserveScans(await get(id), -3)).taken], [0, 0]);
}
{
  const id = await mkSub({ plan_scans: 10 });
  const res = await reserveScan(await get(id));
  check("the scan is taken before the read", (await get(id)).planScans, 9);
  const usage = await giveBackScans(await get(id), res);
  check("a failed read gives the scan back (it was not delivered)", [(await get(id)).planScans, usage.remaining], [10, 10]);
}
{
  const id = await mkSub({ plan_scans: 1 });
  const stale = await get(id);
  const [a, b] = await Promise.all([reserveScan(stale), reserveScan(stale)]);
  check("two reservations, one scan left: exactly one wins", [a.taken + b.taken, (await get(id)).planScans], [1, 0]);

  const id2 = await mkSub({ plan_scans: 100 });
  const stale2 = await get(id2);
  const many = await Promise.all(Array.from({ length: 20 }, () => reserveScan(stale2)));
  check("20 scans in flight against one stale row are all counted (the 12-of-20 leak, subscriber 6cd43f 09-28)",
    [many.filter((r) => r.taken === 1).length, (await get(id2)).planScans], [20, 80]);

  const id3 = await mkSub({ plan_scans: 3, bonus_scans: 1, extra_scans: 1 });
  const stale3 = await get(id3);
  const race = await Promise.all(Array.from({ length: 10 }, () => reserveScan(stale3)));
  const after3 = await get(id3);
  check("ten in flight, five to spend across all three buckets: exactly five win, none goes below zero",
    [race.reduce((n, r) => n + r.taken, 0), after3.planScans, after3.bonusScans, after3.extraScans], [5, 0, 0, 0]);

  const id4 = await mkSub({ plan_scans: 4 });
  const stale4 = await get(id4);
  const [x, y] = await Promise.all([reserveScans(stale4, 3), reserveScans(stale4, 3)]);
  check("two 3-scan reservations against 4: four taken in all, never below zero", [x.taken + y.taken, (await get(id4)).planScans], [4, 0]);
}

// --- cancel pauses the plan scans; resubscribe brings them back -------------------
{
  const id = await mkSub({ plan_scans: 388, extra_scans: 5 });
  await setSubscription(id, "canceled", null, "standard", null);
  let c = await get(id);
  check("cancel: banked plan scans stay on the account but pause; the Booster tier shows them frozen",
    [scanTier(c), scanQuota(c)], ["pack", { used: 0, included: 5, remaining: 5, pack: 5, frozen: 388 }]);
  const r = await reserveScans(c, 5);
  c = await get(id);
  check("cancel: pack scans still work, the frozen plan scans are never touched", [r.taken, c.extraScans, c.planScans], [5, 0, 388]);
  check("cancel: with nothing else left the account is on the trial tier and the banked scans are still shown",
    [scanTier(c), canUseApp(c), scanQuota(c).frozen, scanQuota(c).remaining], ["trial", true, 388, TRIAL_SCANS]);
  const blocked = await reserveScans(await get(id), 100);
  check("cancel: reserving spends the trial, not the paused plan scans", [blocked.draw.plan, blocked.draw.trial, (await get(id)).planScans], [0, TRIAL_SCANS, 388]);
  await setSubscription(id, "active", Date.UTC(2026, 10, 25), "standard", null);
  await creditPlanScans({ userId: id, key: "in_resub", kind: "payment", plan: "standard", scans: PLAN_SCANS.standard });
  c = await get(id);
  check("resubscribe: the frozen balance is back and the new payment stacks on top",
    [scanTier(c), scanQuota(c).plan, scanQuota(c).frozen], ["subscribed", 388 + PLAN_SCANS.standard, undefined]);
}
{
  const id = await mkSub({ plan_scans: 100 });
  const end = Date.UTC(2026, 9, 25);
  await setSubscription(id, "active", end, "standard", end);
  let c = await get(id);
  check("a plan set to cancel: ends on the period end, no next credit, the balance still spends",
    [scanQuota(c).endsAt, scanQuota(c).nextCreditAt, toPublicUser(c).cancelAtPeriodEnd, toPublicUser(c).subEndsAt, (await reserveScan(c)).taken], [end, null, true, end, 1]);
  await setSubscription(id, "active", end, "standard");
  check("an event that does not mention cancellation leaves it alone", (await get(id)).subCancelAt, end);
  await setSubscription(id, "active", end, "standard", null);
  c = await get(id);
  check("resuming (cancel_at cleared) brings the next credit date back",
    [c.subCancelAt, scanQuota(c).nextCreditAt, toPublicUser(c).cancelAtPeriodEnd], [null, end, false]);
}

// --- everyone else keeps today's counters -----------------------------------------
{
  // Comped: the calendar-month counter, then bonus, then pack; a real payment's plan scans wait on the account.
  const id = await mkSub({ access_override: "comp_standard", plan: null, sub_status: null, scan_month: thisMonth, scans_used: PLAN_SCANS.standard - 1, bonus_scans: 1, plan_scans: 40 });
  const r1 = await reserveScan(await get(id));
  check("comped: the month counter goes first", [r1.taken, r1.usage.used, r1.usage.remaining], [1, PLAN_SCANS.standard, 1]);
  const r2 = await reserveScan(await get(id));
  check("comped: then the bonus", [r2.taken, r2.usage.bonus, r2.usage.remaining], [1, 0, 0]);
  const r3 = await reserveScan(await get(id));
  check("comped: then nothing; the plan_scans a paying comp banked are not spent and show as frozen", [r3.taken, (await get(id)).planScans, r3.usage.frozen], [0, 40, 40]);
  const real = await mkSub({ access_override: "comp_standard", plan_scans: 40, scan_month: thisMonth, scans_used: 0 });
  check("comp + a real subscription: the calendar counter spends, not plan_scans",
    [(await reserveScan(await get(real))).usage.used, (await get(real)).planScans], [1, 40]);
}
{
  // Legacy: 100 a day, guarded.
  const id = await mkSub({ sub_status: null, plan: null, created_at: PAID_SWITCH_AT - 1, scan_month: today, scans_used: LEGACY_DAILY_SCANS - 1 });
  const stale = await get(id);
  const [a, b] = await Promise.all([reserveScan(stale), reserveScan(stale)]);
  check("legacy: two in flight with one left today: one wins, used stops at 100", [a.taken + b.taken, (await get(id)).scansUsed], [1, LEGACY_DAILY_SCANS]);
  await db.prepare("UPDATE users SET scan_month = '2020-01-01', scans_used = 60 WHERE id = ?").run(id);
  const fresh1 = await reserveScan(await get(id));
  const row1 = await get(id);
  check("legacy: a new day restarts at 1 with a day stamp", [fresh1.taken, row1.scanMonth, row1.scansUsed], [1, today, 1]);
}
{
  // Owner: metered, never enforced.
  const id = await mkSub({ sub_status: null, plan: null, role: "admin", scan_month: "2020-01", scans_used: 9999 });
  const r = await reserveScans(await get(id), 3);
  const u = await get(id);
  check("owner: always taken, month counter restarted and counting", [r.taken, r.usage.remaining, u.scanMonth, u.scansUsed], [3, null, thisMonth, 3]);
}
{
  // Trial: lifetime, guarded.
  const id = await mkSub({ sub_status: null, plan: null, trial_scans_used: 3 });
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push((await reserveScan(await get(id))).taken);
  check("trial: two left, the third is refused", [seen, (await get(id)).trialScansUsed], [[1, 1, 0], TRIAL_SCANS]);
  await giveBackScans(await get(id), { taken: 1, draw: { plan: 0, bonus: 0, pack: 0, counter: 0, counterKey: null, trial: 1 }, usage: null });
  check("trial: a failed read gives the free scan back", (await get(id)).trialScansUsed, TRIAL_SCANS - 1);
  await db.prepare("UPDATE users SET trial_scans_used = 2 WHERE id = ?").run(base.id);
  const t = (await reserveScan(await findUserById(base.id))).usage;
  check("trial: lifetime counter increments", t, { used: 3, included: TRIAL_SCANS, remaining: TRIAL_SCANS - 3 });
}

// --- header counter: toPublicUser ships the same snapshot scanQuota computes ---
{
  const u = await findUserById(base.id);
  check("toPublicUser.scans = scanQuota(user)", toPublicUser(u).scans, scanQuota(u));
  check("trial snapshot after 3 scans", toPublicUser(u).scans, { used: 3, included: TRIAL_SCANS, remaining: TRIAL_SCANS - 3 });
}

// --- Booster (09-25): one-time buys banked in extra_scans ------------------
{
  const { creditScanPack, packScans } = await import(at("lib/server/users.ts"));
  const { PRICING } = await import(at("lib/pricing.ts"));
  check("pack: scanTier = pack once a balance exists (no subscription)",
    [scanTier(fresh({ extraScans: 0, trialScansUsed: TRIAL_SCANS })), scanTier(fresh({ extraScans: 3, trialScansUsed: TRIAL_SCANS }))],
    ["trial", "pack"]);
  check("pack: the app stays open with a balance after the trial is gone",
    [canUseApp(fresh({ extraScans: 0, trialScansUsed: TRIAL_SCANS })), canUseApp(fresh({ extraScans: 1, trialScansUsed: TRIAL_SCANS }))],
    [false, true]);
  check("pack: quota = the balance", scanQuota(fresh({ extraScans: 42 })), { used: 0, included: 42, remaining: 42, pack: 42 });
  check("pack: plan balance first, then bonus, then pack, all counted in remaining",
    scanQuota(sub({ planScans: PLAN_SCANS.standard - 10, bonusScans: 5, extraScans: 7 })).remaining, PLAN_SCANS.standard - 10 + 5 + 7);
  check("pack: a subscriber is still the subscribed tier", scanTier(sub({ extraScans: 7 })), "subscribed");
  check("pack: legacy accounts stay legacy", scanTier(legacy({ extraScans: 7 })), "legacy");

  // creditScanPack is idempotent per Stripe session.
  check("credit: first time credits", await creditScanPack(base.id, "cs_test_1", PRICING.pack.scans), true);
  check("credit: same session again is a no-op", await creditScanPack(base.id, "cs_test_1", PRICING.pack.scans), false);
  check("credit: a second session stacks", await creditScanPack(base.id, "cs_test_2", PRICING.pack.scans), true);
  check("credit: balance = two packs", packScans(await findUserById(base.id)), PRICING.pack.scans * 2);

  // Trial exhausted + pack: reserving spends the pack.
  await db.prepare("UPDATE users SET trial_scans_used = ? WHERE id = ?").run(TRIAL_SCANS, base.id);
  const p1 = (await reserveScan(await findUserById(base.id))).usage;
  check("reserve (pack tier): spends one pack scan", p1, { used: 0, included: PRICING.pack.scans * 2 - 1, remaining: PRICING.pack.scans * 2 - 1, pack: PRICING.pack.scans * 2 - 1 });
  check("reserve (pack tier): trial counter untouched", (await findUserById(base.id)).trialScansUsed, TRIAL_SCANS);
  check("header snapshot matches", toPublicUser(await findUserById(base.id)).scans, scanQuota(await findUserById(base.id)));

  // Subscriber out of plan scans: bonus goes before pack, pack goes last.
  await db.prepare("UPDATE users SET sub_status = 'active', plan_scans = 0, bonus_scans = 1, extra_scans = 2 WHERE id = ?").run(base.id);
  const s1 = (await reserveScan(await findUserById(base.id))).usage;
  check("reserve (subscribed, no plan scans): bonus spent first", [s1.bonus, s1.pack, s1.remaining], [0, 2, 2]);
  const s2 = (await reserveScan(await findUserById(base.id))).usage;
  check("reserve (subscribed, no plan scans, no bonus): pack spent", [s2.bonus, s2.pack, s2.remaining], [0, 1, 1]);
  const s3 = (await reserveScan(await findUserById(base.id))).usage;
  check("reserve: last pack scan", [s3.pack, s3.remaining, scanQuotaExhausted(await findUserById(base.id))], [0, 0, true]);
  check("reserve: nothing left is refused, never negative", [(await reserveScan(await findUserById(base.id))).taken, (await findUserById(base.id)).extraScans], [0, 0]);

  // Balance gone, subscription gone: back to the trial tier and the wall.
  await db.prepare("UPDATE users SET sub_status = NULL WHERE id = ?").run(base.id);
  check("pack: empty balance falls back to trial + wall", [scanTier(await findUserById(base.id)), canUseApp(await findUserById(base.id))], ["trial", false]);
  await db.prepare("UPDATE users SET trial_scans_used = 3, extra_scans = 0, bonus_scans = 0 WHERE id = ?").run(base.id);
}

// --- cronAuthError ----------------------------------------------------------
const cronReq = (url, headers) => new NextRequest(`http://test${url}`, { headers });
delete process.env.CRON_SECRET;
check("no secret configured → 503", cronAuthError(cronReq("/api/cron/daily?key=x"))?.status, 503);
process.env.CRON_SECRET = "s3cret";
check("missing key → 403", cronAuthError(cronReq("/api/cron/daily"))?.status, 403);
check("wrong ?key → 403", cronAuthError(cronReq("/api/cron/daily?key=nope"))?.status, 403);
check("right ?key passes", cronAuthError(cronReq("/api/cron/daily?key=s3cret")), null);
check("Bearer header passes", cronAuthError(cronReq("/api/cron/daily", { authorization: "Bearer s3cret" })), null);
check("bearer prefix is case-insensitive", cronAuthError(cronReq("/api/cron/daily", { authorization: "bearer s3cret" })), null);
check("wrong Bearer → 403", cronAuthError(cronReq("/api/cron/daily", { authorization: "Bearer wrong" }))?.status, 403);
check("empty secret env still refuses", (() => { process.env.CRON_SECRET = ""; return cronAuthError(cronReq("/api/cron/daily?key="))?.status; })(), 503);
delete process.env.CRON_SECRET;

console.log(failures === 0 ? "\nAll quota checks passed" : `\n${failures} quota check(s) failed`);
// No process.exit(): it would skip the beforeExit hook that closes the libsql
// client, and on Windows that open handle asserts at exit (see lib/db.ts).
process.exitCode = failures === 0 ? 0 : 1;
