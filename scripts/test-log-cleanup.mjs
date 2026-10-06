/**
 * Weekly log retention (lib/server/logCleanup.ts). Run: npm run test:logcleanup
 *
 * Pins: old rows go and fresh ones stay in each log table, 'new' social
 * comments are never touched, protected tables (signup_log) are never
 * touched, the pass runs at most once per 7 days, and a second pass after
 * 7 days runs again. Throwaway file DB.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-logcleanup-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { runLogCleanupIfDue, LOG_CLEANUP_KEY } = await import(at("lib/server/logCleanup.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}
const count = async (t, w = "1=1") => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${w}`).get()).n);

const DAY = 86_400_000;
const now = Date.now();

for (const [i, age] of [500, 10].entries()) {
  await db.prepare("INSERT INTO page_views (day, visitor, path, at) VALUES (?, ?, '/', ?)").run(`d${i}`, `v${i}`, now - age * DAY);
}
for (const age of [100, 5]) {
  await db.prepare("INSERT INTO trial_scans (device_id, ip_hash, at) VALUES ('dev', 'ip', ?)").run(now - age * DAY);
}
const comment = (id, status, ageDays) =>
  db.prepare(
    "INSERT INTO social_comments (id, site, comment_id, post_id, post_url, post_text, author, text, at, kind, status, seen_at) VALUES (?, 'x', ?, 'p', 'u', 't', 'a', 'hi', '2025-01-01', 'other', ?, ?)",
  ).run(id, id, status, now - ageDays * DAY);
await comment("old-new", "new", 400);
await comment("old-done", "dismissed", 400);
await comment("fresh-done", "dismissed", 3);
await db.prepare("INSERT INTO admin_login_codes (who, code_hash, created_at, expires_at) VALUES ('owner', 'h', ?, ?)").run(now - 20 * DAY, now - 20 * DAY);

const first = await runLogCleanupIfDue(now);
check("first run executes and finishes", first.ran === true && first.partial === false);
check("page_views: 500-day-old row deleted, 10-day-old kept", await count("page_views"), 1);
check("trial_scans: 100-day-old row deleted, 5-day-old kept", await count("trial_scans"), 1);
check("social_comments: only the old handled one deleted", (await db.prepare("SELECT id FROM social_comments ORDER BY id").all()).map((r) => r.id), ["fresh-done", "old-new"]);
check("expired admin login code deleted", await count("admin_login_codes"), 0);

// A row that is old again, but the memo says the weekly pass already ran.
await db.prepare("INSERT INTO page_views (day, visitor, path, at) VALUES ('d9', 'v9', '/', ?)").run(now - 600 * DAY);
const second = await runLogCleanupIfDue(now + 2 * DAY);
check("second run inside 7 days does nothing", second.ran, false);
check("old row still there", await count("page_views"), 2);

const third = await runLogCleanupIfDue(now + 8 * DAY);
check("run after 7 days executes again", third.ran, true);
check("and removes the old row", await count("page_views"), 1);
check("memo key stored", (await db.prepare("SELECT value FROM settings WHERE key = ?").get(LOG_CLEANUP_KEY)).value, String(now + 8 * DAY));

// Batching: more old rows than one batch is fully drained.
const many = 12_000;
await db.prepare("INSERT INTO trial_scans (device_id, ip_hash, at) SELECT 'b', 'b', ? FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ?) SELECT x FROM c)").run(now - 900 * DAY, many);
const fourth = await runLogCleanupIfDue(now + 20 * DAY);
check("12k old rows drained across batches", fourth.deleted?.trial_scans, many);
check("only the fresh trial scan remains", await count("trial_scans"), 1);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
