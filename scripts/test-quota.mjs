/**
 * Scan metering + cron gate — the two small server libs money rides on:
 * scanQuota meters the subscription's 500-scans-a-month allowance, and
 * cronAuthError is the only thing between the internet and the daily jobs.
 * Run: npm run test:quota
 *
 * Pins: quota is only ENFORCED for subscribers (remaining null otherwise)
 * but METERED for everyone; the lazy month rollover (a stale scan_month
 * reads as zero used and recordScan restarts the counter); exhaustion at
 * exactly the cap with clamping below zero; grace statuses counting as
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
const { MONTHLY_SCANS, recordScan, scanQuota, scanQuotaExhausted } = await import(at("lib/server/scanQuota.ts"));
const { cronAuthError } = await import(at("lib/server/cronAuth.ts"));
const { createUser, findUserById, LEGACY_DAILY_SCANS, OWNER_EMAIL, PAID_SWITCH_AT, TRIAL_SCANS } = await import(at("lib/server/users.ts"));
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
const sub = (over) => fresh({ subStatus: "active", ...over });
const owner = (over) => fresh({ email: OWNER_EMAIL, ...over });

// --- scanQuota per tier ------------------------------------------------------
check("legacy account: 100 a day, metered by day",
  scanQuota(legacy({ subStatus: null, scansUsed: 40 })),
  { used: 40, included: LEGACY_DAILY_SCANS, remaining: LEGACY_DAILY_SCANS - 40 });
check("legacy account: yesterday's count reads as zero",
  scanQuota(legacy({ subStatus: null, scanMonth: "2020-01-01", scansUsed: 99 })).used, 0);
check("legacy canceled subscriber falls back to the daily cap",
  scanQuota(legacy({ subStatus: "canceled", scansUsed: 1 })).remaining, LEGACY_DAILY_SCANS - 1);
check("fresh account: 10-scan trial, lifetime",
  scanQuota(fresh({ subStatus: null, trialScansUsed: 4 })),
  { used: 4, included: TRIAL_SCANS, remaining: TRIAL_SCANS - 4 });
check("owner: never enforced",
  scanQuota(owner({ subStatus: null, scansUsed: 5000 })).remaining, null);
check("active subscriber: remaining math",
  scanQuota(sub({ scansUsed: 3 })).remaining, Math.max(0, MONTHLY_SCANS - 3));
check("trialing and past_due count as subscribed",
  ["trialing", "past_due"].map((st) => scanQuota(sub({ subStatus: st, scansUsed: 1 })).remaining),
  [MONTHLY_SCANS - 1, MONTHLY_SCANS - 1]);
check("pro subscriber: 2,000 cap",
  scanQuota(sub({ plan: "pro", scansUsed: 10 })).remaining, 2000 - 10);
check("stale month reads as zero used",
  scanQuota(sub({ scanMonth: "2020-01", scansUsed: 499 })),
  { used: 0, included: MONTHLY_SCANS, remaining: MONTHLY_SCANS });
check("null month (never scanned) reads as zero",
  scanQuota(sub({ scanMonth: null, scansUsed: 7 })).used, 0);
check("remaining clamps at zero past the cap",
  scanQuota(sub({ scansUsed: MONTHLY_SCANS + 25 })).remaining, 0);

check("exhausted exactly at the cap",
  scanQuotaExhausted(sub({ scansUsed: MONTHLY_SCANS })), true);
check("one left ≠ exhausted",
  scanQuotaExhausted(sub({ scansUsed: MONTHLY_SCANS - 1 })), false);
check("trial exhausted at 10",
  scanQuotaExhausted(fresh({ subStatus: null, trialScansUsed: TRIAL_SCANS })), true);
check("legacy exhausted at 100 for the day",
  scanQuotaExhausted(legacy({ subStatus: null, scansUsed: LEGACY_DAILY_SCANS })), true);
check("owner is never exhausted",
  scanQuotaExhausted(owner({ subStatus: null, scansUsed: MONTHLY_SCANS * 2 })), false);

// --- recordScan: subscriber stamps the month, restarts on rollover ----------
await db.prepare("UPDATE users SET sub_status = 'active', created_at = ? WHERE id = ?").run(PAID_SWITCH_AT + 1, base.id);
const row = async () => {
  const r = await findUserById(base.id);
  return { month: r.scanMonth, used: r.scansUsed };
};
await recordScan(await findUserById(base.id));
check("first scan stamps the month", await row(), { month: thisMonth, used: 1 });
await recordScan(await findUserById(base.id));
check("second scan increments", await row(), { month: thisMonth, used: 2 });
// Fake a counter left over from a previous month, then scan again.
await db.prepare("UPDATE users SET scan_month = '2020-01', scans_used = 480 WHERE id = ?").run(base.id);
await recordScan(await findUserById(base.id));
check("rollover restarts the counter at 1", await row(), { month: thisMonth, used: 1 });

// --- recordScan: legacy stamps the day; trial counts lifetime ---------------
await db.prepare("UPDATE users SET sub_status = NULL, created_at = ?, scan_month = '2020-01-01', scans_used = 60 WHERE id = ?").run(PAID_SWITCH_AT - 1, base.id);
await recordScan(await findUserById(base.id));
check("legacy: new day restarts at 1 with a day stamp", await row(), { month: today, used: 1 });
await db.prepare("UPDATE users SET created_at = ?, trial_scans_used = 2 WHERE id = ?").run(PAID_SWITCH_AT + 1, base.id);
const t = await recordScan(await findUserById(base.id));
check("trial: lifetime counter increments", t, { used: 3, included: TRIAL_SCANS, remaining: TRIAL_SCANS - 3 });

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
