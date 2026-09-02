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
const { createUser, findUserById } = await import(at("lib/server/users.ts"));
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
const base = await createUser("Q", "quota@example.com", "hunter22");
const u = (over) => ({ ...base, scanMonth: thisMonth, ...over });

// --- scanQuota: enforced for subscribers, metered for everyone --------------
check("non-subscriber: metered but not enforced",
  scanQuota(u({ subStatus: null, scansUsed: 40 })),
  { used: 40, included: MONTHLY_SCANS, remaining: null });
check("active subscriber: remaining math",
  scanQuota(u({ subStatus: "active", scansUsed: 3 })).remaining, Math.max(0, MONTHLY_SCANS - 3));
check("trialing and past_due count as subscribed",
  ["trialing", "past_due"].map((s) => scanQuota(u({ subStatus: s, scansUsed: 1 })).remaining),
  [MONTHLY_SCANS - 1, MONTHLY_SCANS - 1]);
check("canceled is not enforced",
  scanQuota(u({ subStatus: "canceled", scansUsed: 1 })).remaining, null);
check("stale month reads as zero used",
  scanQuota(u({ subStatus: "active", scanMonth: "2020-01", scansUsed: 499 })),
  { used: 0, included: MONTHLY_SCANS, remaining: MONTHLY_SCANS });
check("null month (never scanned) reads as zero",
  scanQuota(u({ subStatus: "active", scanMonth: null, scansUsed: 7 })).used, 0);
check("remaining clamps at zero past the cap",
  scanQuota(u({ subStatus: "active", scansUsed: MONTHLY_SCANS + 25 })).remaining, 0);

check("exhausted exactly at the cap",
  scanQuotaExhausted(u({ subStatus: "active", scansUsed: MONTHLY_SCANS })), true);
check("one left ≠ exhausted",
  scanQuotaExhausted(u({ subStatus: "active", scansUsed: MONTHLY_SCANS - 1 })), false);
check("free accounts are never exhausted",
  scanQuotaExhausted(u({ subStatus: null, scansUsed: MONTHLY_SCANS * 2 })), false);

// --- recordScan: increments, and restarts on rollover -----------------------
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
