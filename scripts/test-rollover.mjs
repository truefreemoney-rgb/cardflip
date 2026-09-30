/**
 * Scan rollover, the parts that are not the webhook or the quota math
 * (Chris, 09-30). Run: npm run test:rollover
 *
 * Pins: the ledger (one row per change, an off-by-default cap that only trims NEW
 * credits, reversals floor at zero, hand adjustments); the lazy seed and the
 * migration script agreeing (dry run writes nothing, --apply seeds September's
 * leftover per subscriber whatever month the clock says, never touches legacy /
 * comped / owner accounts, lists a live-in-Stripe override for a human, is
 * idempotent, adds instead of assigning so a payment that landed first survives,
 * and creates the schema exactly as db.ts does); the daily reconcile (credits a
 * paid invoice whose webhook never arrived, only once, ignores what the seed
 * stands for, is capped, and reports instead of throwing); the out-of-scans
 * message; and the route wiring (reserve BEFORE the paid call, give back on
 * failure, import reserves through hooks, tiebreak has a daily budget).
 * Stripe is a stub: nothing here touches the network.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_PRICE_ID = "price_std";
process.env.STRIPE_PRO_PRICE_ID = "price_pro";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-rollover-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
const dbFile = path.join(work, "data", "cardflip.db");

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const { db } = await import(at("lib/db.ts"));
const { PRICING, ROLLOVER } = await import(at("lib/pricing.ts"));
const { SEED_MONTH, CREDITS_FROM, seedAmount } = await import(at("lib/planSeed.ts"));
const { createUser, findUserById, planSeedFor, scanQuota, setSubscription, PAID_SWITCH_AT, OWNER_EMAIL } = await import(at("lib/server/users.ts"));
const { adjustPlanScans, creditPlanScans, ensurePlanSeed, ledgerForUser, reversePlanScans } = await import(at("lib/server/scanCredits.ts"));
const { outOfScansMessage, reserveScan } = await import(at("lib/server/scanQuota.ts"));
const { reconcilePaidInvoices, planCreditFor } = await import(at("lib/server/billingCredits.ts"));
const { run: runMigration } = await import(new URL("./migrate-plan-balance.mjs", import.meta.url).href);

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const STD = PRICING.standard.scans;
const PRO = PRICING.pro.scans;
const realNow = Date.now;
const atTime = async (ms, fn) => {
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = realNow; }
};
const OCT_2 = Date.UTC(2026, 9, 2, 12);

let seq = 0;
async function mkUser(set = {}, email = `u${++seq}@example.com`) {
  const u = await createUser("T", email, "hunter22");
  const cols = { sub_status: "active", created_at: PAID_SWITCH_AT + 1, plan: "standard", ...set };
  await db.prepare(`UPDATE users SET ${Object.keys(cols).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...Object.values(cols), u.id);
  return u.id;
}
const get = (id) => findUserById(id);
const rows = async (sql, ...args) => (await db.prepare(sql).all(...args)).map((r) => ({ ...r }));
const errorsFrom = async (frag) => (await rows("SELECT source, message FROM error_events ORDER BY at")).filter((e) => e.source.includes(frag)).map((e) => e.message);
const credit = (userId, key, over = {}) => creditPlanScans({ userId, key, kind: "payment", plan: "standard", scans: STD, ...over });

// --- the ledger ---------------------------------------------------------------------
console.log("ledger");
{
  check("the cap is off by default", ROLLOVER.maxMonths, null);
  const id = await mkUser({ plan_scans: 0 });
  await credit(id, "in_c1");
  await credit(id, "in_c2");
  await credit(id, "in_c3");
  check("no cap: three payments stack to three allowances", (await get(id)).planScans, STD * 3);

  ROLLOVER.maxMonths = 2;
  const capped = await mkUser({ plan_scans: 0 });
  await credit(capped, "in_k1");
  await credit(capped, "in_k2");
  const third = await credit(capped, "in_k3");
  check("cap of 2 months: the third payment is trimmed to nothing, the row still says what was asked",
    [third.applied, (await get(capped)).planScans, (await ledgerForUser(capped)).find((r) => r.credit_key === "in_k3").scans], [0, STD * 2, STD]);
  const half = await mkUser({ plan_scans: STD * 2 - 100 });
  const partial = await credit(half, "in_k4");
  check("cap: a credit that only partly fits adds what fits", [partial.applied, (await get(half)).planScans], [100, STD * 2]);
  const over = await mkUser({ plan_scans: STD * 5 });
  await credit(over, "in_k5");
  check("cap: a balance already above it is never taken back", (await get(over)).planScans, STD * 5);
  ROLLOVER.maxMonths = null;
}
{
  const id = await mkUser({ plan_scans: 100 });
  const r1 = await reversePlanScans({ userId: id, key: "refund:ch_1:100", refKey: "in_x", scans: 60 });
  const r2 = await reversePlanScans({ userId: id, key: "refund:ch_1:200", refKey: "in_x", scans: 60 });
  const again = await reversePlanScans({ userId: id, key: "refund:ch_1:200", refKey: "in_x", scans: 60 });
  check("reversal takes what it can and floors at zero", [r1.applied, r2.applied, (await get(id)).planScans], [-60, -40, 0]);
  check("the same reversal key twice does nothing", [again.recorded, (await ledgerForUser(id)).length], [false, 2]);
  const adj = await adjustPlanScans(id, 25, "goodwill");
  const adjDown = await adjustPlanScans(id, -100, "refund by hand");
  check("adjust: adds, and a take-back floors at zero", [adj.applied, adjDown.applied, (await get(id)).planScans], [25, -25, 0]);
  check("adjust on a missing user is refused", (await adjustPlanScans("nope", 5, "x")).recorded, false);
}

// --- the seed, the migration script and the app agree -----------------------------------
console.log("\nseed + migration");
let renewalUser;
{
  const id = await mkUser({ scan_month: SEED_MONTH, scans_used: 12 });
  renewalUser = id;
  const renewal = await atTime(OCT_2, () => credit(id, "in_renew"));
  const u = await get(id);
  check("a renewal that lands before the migration seeds first, in the same transaction, then adds",
    [renewal.seeded, renewal.applied, u.planScans], [STD - 12, STD, STD - 12 + STD]);
  check("the ledger: the seed, then the payment", (await rows("SELECT credit_key, applied FROM scan_credits WHERE user_id = ? ORDER BY rowid", id)).map((r) => [r.credit_key === `migration:${id}` ? "migration" : r.credit_key, r.applied]), [["migration", STD - 12], ["in_renew", STD]]);
  check("the payment is not part of what counts as 'carried over'", [scanQuota(u).plan, scanQuota(u).carried, scanQuota(u).lastCredit], [STD * 2 - 12, STD - 12, STD]);
  check("seeding again does nothing", await atTime(OCT_2, () => ensurePlanSeed(id)), 0);
}

const asOf = async (f) => atTime(OCT_2, f);
async function fixture() {
  const f = {};
  f.a = await mkUser({ scan_month: SEED_MONTH, scans_used: 12 }); // 6cd43f: 12 of 250 used in September
  f.b = await mkUser({ plan: "pro", scan_month: SEED_MONTH, scans_used: 100 });
  f.c = await mkUser({ scan_month: "2026-10", scans_used: 5 }); // the old code already rolled it to October
  f.d = await mkUser({ scan_month: null });
  f.e = await mkUser({ access_override: "legacy", plan: null, scan_month: "2026-09-30", scans_used: 40 }); // f49d79: live in Stripe on a legacy override
  f.f = await mkUser({ access_override: "comp_standard", sub_status: null, plan: null });
  f.g = await mkUser({ role: "admin" });
  f.h = await mkUser({ sub_status: "canceled", scan_month: SEED_MONTH, scans_used: 1 });
  f.i = await mkUser({ plan_scans: 300, scan_month: SEED_MONTH, scans_used: 1 });
  f.j = await mkUser({ sub_status: "past_due", scan_month: SEED_MONTH, scans_used: 0 });
  f.owner = await mkUser({}, OWNER_EMAIL);
  // September as the scan ledger saw it for c: 20 real scans, one binder locate and one tiebreak (not scans).
  const sep = Date.UTC(2026, 8, 12);
  const usage = (n, read) => db.prepare("INSERT INTO scan_usage (id, user_id, at, model, input_tokens, output_tokens, cost_micros, read) VALUES (?, ?, ?, 'm', 1, 1, 1, ?)").run(`su${n}${f.c}`, f.c, sep + n * 1000, read);
  for (let n = 0; n < 20; n++) await usage(n, JSON.stringify({ name: "x" }));
  await usage(20, JSON.stringify({ locate: true, found: 9 }));
  await usage(21, JSON.stringify({ tiebreak: ["a", "b"] }));
  await db.prepare("INSERT INTO scan_usage (id, user_id, at, model, input_tokens, output_tokens, cost_micros, read) VALUES (?, ?, ?, 'm', 1, 1, 1, NULL)").run(`suoct${f.c}`, f.c, Date.UTC(2026, 9, 1, 3));
  return f;
}
const snapshot = async (ids) => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, (await get(id)).planScans])));

{
  const f = await fixture();
  const before = await snapshot(f);
  const log = [];
  const dry = await asOf(() => runMigration(["--db", dbFile], (l) => log.push(l)));
  const after = await snapshot(f);
  check("dry run writes nothing", [JSON.stringify(after) === JSON.stringify(before), (await rows("SELECT COUNT(*) AS n FROM scan_credits WHERE kind = 'migration' AND credit_key LIKE ?", `%${f.b}`))[0].n], [true, 0]);
  const seedOf = (id) => dry.entries.find((e) => e.id === id);
  check("what each subscriber would get: September's leftover, from the counter (a, b, j) or the scan ledger when the row moved on (c) or the full cap (d)",
    [seedOf(f.a).seed, seedOf(f.b).seed, seedOf(f.j).seed, seedOf(f.c).seed, seedOf(f.c).source.startsWith("scan_usage ledger"), seedOf(f.d).seed],
    [STD - 12, PRO - 100, STD, STD - 20, true, STD]);
  check("skipped: the legacy override, the admin and the account that already has a balance",
    [f.e, f.g, f.i].map((id) => seedOf(id).action), ["skip", "skip", "skip"]);
  check("comped (no Stripe status) and canceled accounts never appear at all; the owner's own account is skipped",
    [seedOf(f.f), seedOf(f.h), seedOf(f.owner).action], [undefined, undefined, "skip"]);
  check("the live-in-Stripe override is flagged for a human", [log.some((l) => l.includes("LIVE in Stripe") && l.includes("legacy")), log.some((l) => l.includes("Needs a human") && l.includes(f.e.slice(0, 8)))], [true, true]);
  check("the output says it is a dry run and prints before -> after per user",
    [log[0].startsWith("DRY RUN"), log.some((l) => l.includes(`plan_scans NULL -> ${STD - 12}`))], [true, true]);

  const applyLog = [];
  const applied = await asOf(() => runMigration(["--db", dbFile, "--apply"], (l) => applyLog.push(l)));
  const got = await snapshot(f);
  check("--apply seeds September's leftover",
    [got.a, got.b, got.c, got.d, got.j], [STD - 12, PRO - 100, STD - 20, STD, STD]);
  check("…and never touches the override, comped, admin, canceled or already-funded accounts",
    [got.e, got.f, got.g, got.h, got.i], [null, null, null, null, 300]);
  check("one ledger row per seeded subscriber, keyed migration:<id>, and none for the skipped",
    (await rows("SELECT credit_key FROM scan_credits WHERE kind = 'migration' AND credit_key IN (?, ?, ?, ?, ?, ?, ?) ORDER BY credit_key", ...[f.a, f.b, f.c, f.d, f.e, f.g, f.i].map((x) => `migration:${x}`))).map((r) => r.credit_key),
    [f.a, f.b, f.c, f.d].map((x) => `migration:${x}`).sort());
  check("the apply output is 'NULL -> n' per user", applyLog.some((l) => l.startsWith("  ") && l.includes(`plan_scans NULL -> ${PRO - 100}`)), true);
  check("apply counts what it wrote", applied.seeded, 5);

  const second = await asOf(() => runMigration(["--db", dbFile, "--apply"], () => {}));
  check("a second --apply changes nothing (idempotent)", [second.seeded, JSON.stringify(await snapshot(f)) === JSON.stringify(got)], [0, true]);
  check("a renewal that landed before the script survives it: the balance is still seed + payment, no second seed, nothing overwritten",
    [(await get(renewalUser)).planScans, (await ledgerForUser(renewalUser)).length], [STD * 2 - 12, 2]);
  check("the app's lazy seed after the script adds nothing either", [await asOf(() => ensurePlanSeed(f.a)), (await get(f.a)).planScans], [0, STD - 12]);

  // The clock does not matter: the month is fixed (a run after Oct 1 00:00 UTC gives the same answer).
  const g = await mkUser({ scan_month: SEED_MONTH, scans_used: 12 });
  const early = await atTime(Date.UTC(2026, 8, 30, 12), () => runMigration(["--db", dbFile], () => {}));
  const late = await atTime(Date.UTC(2026, 9, 3, 12), () => runMigration(["--db", dbFile], () => {}));
  check("run before or after the month flipped: the same seed", [early.entries.find((e) => e.id === g).seed, late.entries.find((e) => e.id === g).seed], [STD - 12, STD - 12]);

  // Whoever gets to a subscriber first, the other adds nothing.
  const first = await mkUser({ scan_month: SEED_MONTH, scans_used: 30 });
  await asOf(() => ensurePlanSeed(first));
  const viaScript = await asOf(() => runMigration(["--db", dbFile, "--apply"], () => {}));
  check("app seeded first: the script skips it, one seed only", [(await get(first)).planScans, viaScript.entries.find((e) => e.id === first).action, (await ledgerForUser(first)).length], [STD - 30, "skip", 1]);
  check("planSeedFor and seedAmount are the one rule", [seedAmount(STD, SEED_MONTH, 12), seedAmount(STD, "2026-10", 12), seedAmount(STD, null, null)], [STD - 12, STD, STD]);
  check("planSeedFor is null once a balance exists", planSeedFor(await get(first)), null);
}

// --- the migration creates the schema exactly as the app does -----------------------------
{
  const old = path.join(work, "old.db");
  const raw = new DatabaseSync(old);
  raw.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, created_at INTEGER, sub_status TEXT, plan TEXT,
    access_override TEXT, scan_month TEXT, scans_used INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users (id, name, email, role, created_at, sub_status, plan, scan_month, scans_used) VALUES ('old1', 'O', 'o@x.io', 'user', 1, 'active', 'standard', '${SEED_MONTH}', 7);`);
  raw.close();
  const dry = await runMigration(["--db", old], () => {});
  check("a database from before the deploy: a dry run reads it (no columns yet) and writes nothing", [dry.entries[0].seed, dry.entries[0].before], [STD - 7, null]);
  const check1 = new DatabaseSync(old);
  check("…the columns really are not there after a dry run", check1.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "plan_scans"), false);
  check1.close();
  await runMigration(["--db", old, "--apply"], () => {});
  const after = new DatabaseSync(old);
  const cols = (d, table, names) => d.prepare(`PRAGMA table_info(${table})`).all().filter((c) => !names || names.includes(c.name)).map((c) => [c.name, c.type, c.notnull, c.dflt_value]);
  const usersCols = ["plan_scans", "plan_credit_scans", "plan_credit_at", "sub_cancel_at"];
  const fromScript = { users: cols(after, "users", usersCols), ledger: cols(after, "scan_credits") };
  const idx = after.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'scan_credits' AND name LIKE 'idx_%' ORDER BY name").all().map((r) => r.name);
  const seeded = after.prepare("SELECT plan_scans FROM users WHERE id = 'old1'").get();
  after.close();
  const appDb = new DatabaseSync(dbFile);
  const fromApp = { users: cols(appDb, "users", usersCols), ledger: cols(appDb, "scan_credits") };
  const appIdx = appDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'scan_credits' AND name LIKE 'idx_%' ORDER BY name").all().map((r) => r.name);
  appDb.close();
  check("--apply on the old database seeds it", seeded.plan_scans, STD - 7);
  check("the script's columns and ledger table match db.ts exactly (names, types, defaults, indexes)",
    [JSON.stringify(fromScript.users.sort()) === JSON.stringify(fromApp.users.sort()), JSON.stringify(fromScript.ledger) === JSON.stringify(fromApp.ledger), idx.join()], [true, true, appIdx.join()]);
}

// --- daily reconcile ------------------------------------------------------------------
console.log("\nreconcile");
{
  const paidAt = Math.floor(Date.UTC(2026, 9, 5, 12) / 1000);
  const owner = await mkUser({ plan_scans: 0, stripe_customer_id: "cus_rc1" });
  const other = await mkUser({ plan_scans: 0, stripe_customer_id: "cus_rc2" });
  const invoice = (id, cus, price, over = {}) => ({
    id, customer: cus, status: "paid", billing_reason: "subscription_cycle", amount_paid: 999, created: paidAt,
    status_transitions: { paid_at: paidAt },
    parent: { subscription_details: { subscription: "sub_rc" } },
    lines: { data: [{ pricing: { price_details: { price } }, amount: 999, parent: { subscription_item_details: { proration: false } } }] },
    ...over,
  });
  // The webhook already credited in_rc_have; the rest never arrived.
  await credit(owner, "in_rc_have");
  const pages = [
    { data: [invoice("in_rc_new", "cus_rc1", "price_std"), invoice("in_rc_have", "cus_rc1", "price_std"), invoice("in_rc_old", "cus_rc1", "price_std", { status_transitions: { paid_at: Math.floor(Date.UTC(2026, 8, 25) / 1000) }, created: Math.floor(Date.UTC(2026, 8, 25) / 1000) })], hasMore: true },
    { data: [invoice("in_rc_pro", "cus_rc2", "price_pro"), invoice("in_rc_mystery", "cus_rc2", "price_mystery"), invoice("in_rc_ghost", "cus_ghost", "price_std")], hasMore: false },
  ];
  const asked = [];
  const list = async (createdGte, after) => {
    asked.push([createdGte, after ?? null]);
    return after ? pages[1] : pages[0];
  };
  const now = Date.UTC(2026, 9, 6, 12);
  const res = await reconcilePaidInvoices({ now, list });
  check("credits the missed invoices, skips the credited one and the pre-rollover one; reports the unknown price and the ghost customer",
    [res.checked, res.credited, res.before, res.unknownPrice, res.noUser, res.failed, res.pages], [6, 2, 1, 1, 1, 0, 2]);
  check("balances: the missed standard invoice, the missed Pro invoice", [(await get(owner)).planScans, (await get(other)).planScans], [STD * 2, PRO]);
  check("it walked two pages, newest first, from 35 days back",
    [asked[0][1], asked[1][1], asked[0][0]], [null, "in_rc_old", Math.floor((now - 35 * 86_400_000) / 1000)]);
  check("a missed payment is reported so a human checks the webhook", (await errorsFrom("credited missed payments")).some((m) => m.includes("2 paid invoice")), true);
  check("unknown price and unknown customer land on the Errors page",
    [(await errorsFrom("unknown price id")).some((m) => m.includes("in_rc_mystery")), (await errorsFrom("no account")).some((m) => m.includes("in_rc_ghost"))], [true, true]);
  const again = await reconcilePaidInvoices({ now, list });
  check("running it again credits nothing (idempotent by invoice id)", [again.credited, (await get(owner)).planScans, (await get(other)).planScans], [0, STD * 2, PRO]);

  const slow = await reconcilePaidInvoices({ now, list, budgetMs: -1 });
  check("a spent time budget stops the walk and says so, without throwing", [slow.partial, slow.pages], [true, 0]);
  const capped = await reconcilePaidInvoices({ now, list, maxPages: 1 });
  check("a page cap stops it and says so", [capped.partial, capped.pages], [true, 1]);

  const boom = await reconcilePaidInvoices({ now, list: async () => { throw new Error("stripe: invoices unreachable"); } });
  check("a Stripe failure is reported, not thrown", [boom.error, (await errorsFrom("billing/reconcile")).some((m) => m.includes("unreachable"))], ["stripe: invoices unreachable", true]);

  // A young credit that arrives within the hour of payment is the webhook's twin, not a missed one.
  const soon = await mkUser({ plan_scans: 0, stripe_customer_id: "cus_rc3" });
  const fresh = invoice("in_rc_fresh", "cus_rc3", "price_std", { status_transitions: { paid_at: Math.floor(now / 1000) - 60 }, created: Math.floor(now / 1000) - 60 });
  const before = (await errorsFrom("credited missed payments")).length;
  await reconcilePaidInvoices({ now, list: async () => ({ data: [fresh], hasMore: false }) });
  check("an invoice paid a minute ago is credited but not reported as a missed webhook", [(await get(soon)).planScans, (await errorsFrom("credited missed payments")).length], [STD, before]);

  // Live subscribers with no credit in 35 days are flagged (a webhook that has been down for good).
  const quiet = await mkUser({ plan_scans: 50 });
  const flagged = await reconcilePaidInvoices({ now: Date.now(), list: async () => ({ data: [], hasMore: false }) });
  check("live subscribers with no credit in 35 days are flagged (override, admin and credited accounts are not)", [flagged.stale >= 1, (await errorsFrom("no recent credit")).length >= 1], [true, true]);
  void quiet;

  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  check("no Stripe key here (CI, a fresh clone): skipped, nothing thrown", (await reconcilePaidInvoices()).skipped, "stripe is not configured here");
  process.env.STRIPE_SECRET_KEY = saved;
  check("the daily job runs it first, before the slow steps", src("lib/server/dailyJobs.ts").indexOf("reconcilePaidInvoices()") < src("lib/server/dailyJobs.ts").indexOf("hasTcgplayerMap()"), true);
  check("reconcile never credits an invoice paid before rollover began", CREDITS_FROM, Date.UTC(2026, 9, 1));
}

// --- invoice reading -----------------------------------------------------------------------
console.log("\ninvoice reading");
{
  const line = (price, amount, proration = false) => ({ pricing: { price_details: { price } }, amount, parent: { subscription_item_details: { proration } } });
  const inv = (lines, over = {}) => ({ id: "in_x", customer: "c", status: "paid", billing_reason: "subscription_cycle", amount_paid: 999, parent: { subscription_details: { subscription: "sub" } }, lines: { data: lines }, ...over });
  check("a regular line on the standard price → standard's scans", planCreditFor(inv([line("price_std", 999)])), { kind: "payment", plan: "standard", scans: STD, priceId: "price_std" });
  check("older shape: lines[].price.id", planCreditFor({ id: "in_o", subscription: "sub", lines: { data: [{ price: { id: "price_pro" }, amount: 1999 }] } }).scans, PRO);
  check("a renewal invoice that also carries proration lines: the regular line decides, not line 0",
    planCreditFor(inv([line("price_std", -500, true), line("price_pro", 1000, true), line("price_pro", 1999)])).scans, PRO);
  check("a price nobody knows is never guessed", planCreditFor(inv([line("price_zzz", 999)])), { kind: "unknown_price", priceId: "price_zzz" });
  check("no lines: nothing to credit", planCreditFor(inv([])).kind, "none");
  check("proration outside a plan change credits nothing", planCreditFor(inv([line("price_pro", 1000, true)], { billing_reason: "manual" })).kind, "none");
}

// --- the out-of-scans message ---------------------------------------------------------------------
console.log("\nmessages");
{
  const next = Date.UTC(2026, 9, 25, 14);
  const sub = await mkUser({ plan_scans: 0, sub_period_end: next });
  const msg = outOfScansMessage(await get(sub));
  check("a subscriber is told the next credit date (Eastern) and that a Scan Pack works now",
    [msg.includes("Oct 25"), msg.includes(String(STD)), msg.includes("Scan Pack"), msg.includes("this month") || msg.includes("resets")], [true, true, true, false]);
  await setSubscription(sub, "active", next, "standard", next);
  const ending = outOfScansMessage(await get(sub));
  check("a plan that is ending promises no credit, only a Scan Pack", [ending.includes("Oct 25"), ending.includes("Scan Pack")], [false, true]);
  await setSubscription(sub, "canceled", null, "standard", null);
  await db.prepare("UPDATE users SET plan_scans = 388 WHERE id = ?").run(sub);
  const frozen = outOfScansMessage(await get(sub));
  check("a canceled account is told its banked scans come back on resubscribe", [frozen.includes("388"), frozen.includes("resubscribe")], [true, true]);
  const trial = await mkUser({ sub_status: null, plan: null });
  check("a trial account keeps the plain wall message", outOfScansMessage(await get(trial)), "You're out of scans. Subscribe or buy a Scan Pack to keep scanning");
}

// --- route wiring ------------------------------------------------------------------------------
console.log("\nroutes");
{
  const scan = src("app/api/vision/scan/route.ts");
  check("the scan route reserves BEFORE the paid vision call", scan.indexOf("reserveScan(user)") > 0 && scan.indexOf("reserveScan(user)") < scan.indexOf("analyzeCardImageWithUsage("), true);
  check("…and gives the scan back when the read throws", /catch \(err\) \{\s*await giveBackScans\(user, reservation\)/.test(scan), true);
  check("…and no longer counts after the call", scan.includes("recordScan("), false);
  check("…and answers 402 before spending anything when nothing is left", /reservation\.taken < 1\) return outOfScans/.test(scan), true);
  const imp = src("app/api/cards/import/route.ts");
  check("the import route reserves through commitImport's hooks and gives back the unused", [imp.includes("reserveScans(user, n)"), imp.includes("giveBackScans(user, paid.held, n)"), imp.includes("recordScans(")], [true, true, false]);
  const loc = src("app/api/vision/locate/route.ts");
  check("the locate route (a paid call that is not a scan) has its own durable daily budget before the call", loc.indexOf("await dayBudgetSpent(`locate_${user.id}`") > 0 && loc.indexOf("await dayBudgetSpent(") < loc.indexOf("await locateCards("), true);
  const tie = src("app/api/vision/tiebreak/route.ts");
  check("the tiebreak route has a durable daily budget before its Opus call", tie.includes("dayBudgetSpent(`tiebreak_${user.id}`") && tie.indexOf("await dayBudgetSpent(") < tie.indexOf("await tiebreakByPicture("), true);
  check("the plan/ledger code hard-codes no scan count or price", ["scanCredits.ts", "billingCredits.ts", "scanQuota.ts"].every((f) => !/\b(250|750)\b/.test(src(`lib/server/${f}`))), true);
  // A live subscriber's reservation really is atomic when the request's row is stale (the whole point).
  const id = await mkUser({ plan_scans: 3 });
  const stale = await get(id);
  const seen = await Promise.all([reserveScan(stale), reserveScan(stale), reserveScan(stale), reserveScan(stale)]);
  check("four scans in flight against three: three taken, one refused", [seen.filter((r) => r.taken === 1).length, (await get(id)).planScans], [3, 0]);
}

console.log(failures ? `\n${failures} failing` : "\nall rollover checks passed");
process.exitCode = failures ? 1 : 0;
