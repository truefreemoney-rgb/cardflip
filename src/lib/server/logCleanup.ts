import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * Weekly retention for the append-only log tables, so they stop growing
 * forever (audit 10-06 F2). Called from the daily job; runs at most once per
 * 7 days (memo in the settings table), deletes in bounded batches, never throws.
 *
 * Only tables that are pure logs or dead one-time tokens are listed. Nothing
 * money, billing, ledger, user, card or listing related is touched, and
 * neither are the tables other code uses as a standing guard or cost record:
 * signup_log (one signup per device/IP), scan_usage (cost_micros margin
 * ledger), price_checks (users' own history), error_events (own ring buffer,
 * errorLog.ts), rate_limits (own hourly sweep, rateLimitDb.ts).
 */

const DAY = 24 * 60 * 60 * 1000;
export const LOG_CLEANUP_KEY = "log_cleanup_last";
const EVERY_MS = 7 * DAY;
/** Rows per DELETE, and the most batches one run spends on one table. */
const BATCH = 5000;
const MAX_BATCHES = 20;
/** Stop starting new batches after this long (the daily function has 300 s). */
const BUDGET_MS = 30_000;

interface Rule {
  table: string;
  /** Primary-key columns, for WITHOUT ROWID tables; omit to use rowid. */
  key?: string;
  /** WHERE clause with exactly one `?` (the cutoff ms). */
  where: string;
  maxAgeMs: number;
}

export const RULES: Rule[] = [
  // Admin analytics read at most a 366-day custom window (analytics.ts), so keep a bit more.
  { table: "page_views", key: "day, visitor, path", where: "at < ?", maxAgeMs: 400 * DAY },
  // The free-scan cap looks back 30 days (trialScan.ts).
  { table: "trial_scans", where: "at < ?", maxAgeMs: 90 * DAY },
  // Handled comments only; 'new' ones are the inbox and stay until someone acts.
  // The per-thread/author reply caps only matter for recent threads.
  { table: "social_comments", key: "id", where: "status <> 'new' AND seen_at < ?", maxAgeMs: 365 * DAY },
  // Expired reset links / sign-in codes: dead the moment they expire; a month's grace for support.
  { table: "password_resets", key: "token_hash", where: "expires_at < ?", maxAgeMs: 30 * DAY },
  { table: "login_codes", key: "user_id", where: "expires_at < ?", maxAgeMs: 7 * DAY },
  { table: "admin_login_codes", key: "who", where: "expires_at < ?", maxAgeMs: 7 * DAY },
];

export interface CleanupResult {
  ran: boolean;
  deleted?: Record<string, number>;
  /** True when a table still had old rows left, so the next daily run tries again. */
  partial?: boolean;
  error?: string;
}

/** Delete one table's expired rows in bounded batches; returns rows deleted and whether it drained. */
async function cleanTable(rule: Rule, now: number, deadline: number): Promise<{ deleted: number; drained: boolean }> {
  const cutoff = now - rule.maxAgeMs;
  const keyCols = rule.key ?? "rowid";
  const keyExpr = rule.key && rule.key.includes(",") ? `(${rule.key})` : keyCols;
  const sql = `DELETE FROM ${rule.table} WHERE ${keyExpr} IN (SELECT ${keyCols} FROM ${rule.table} WHERE ${rule.where} LIMIT ${BATCH})`;
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    if (Date.now() > deadline) return { deleted, drained: false };
    const r = await db.prepare(sql).run(cutoff);
    deleted += r.changes;
    if (r.changes < BATCH) return { deleted, drained: true };
  }
  return { deleted, drained: false };
}

/**
 * Run the retention pass if the last full one was 7+ days ago. A table that
 * errors or isn't finished leaves the memo unset so the next daily run resumes.
 */
export async function runLogCleanupIfDue(now = Date.now()): Promise<CleanupResult> {
  try {
    const last = Number((await getSetting(LOG_CLEANUP_KEY)) ?? 0);
    if (last && now - last < EVERY_MS) return { ran: false };
    const deadline = Date.now() + BUDGET_MS;
    const deleted: Record<string, number> = {};
    let partial = false;
    for (const rule of RULES) {
      try {
        const r = await cleanTable(rule, now, deadline);
        deleted[rule.table] = r.deleted;
        if (!r.drained) partial = true;
      } catch (err) {
        partial = true;
        console.error(`log cleanup: ${rule.table} failed:`, err);
      }
    }
    if (!partial) await setSetting(LOG_CLEANUP_KEY, String(now));
    return { ran: true, deleted, partial };
  } catch (err) {
    console.error("log cleanup failed:", err);
    return { ran: false, error: err instanceof Error ? err.message : String(err) };
  }
}
