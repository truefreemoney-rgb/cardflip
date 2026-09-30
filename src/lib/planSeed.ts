/**
 * The one-time move from the calendar-month counter to the rollover balance
 * (Chris, 09-30). No imports and no db, so the app (users.ts, scanCredits.ts)
 * and scripts/migrate-plan-balance.mjs share the exact same rule.
 *
 * Rule: a subscriber who paid under the old rules is seeded with what was left
 * of SEPTEMBER's allowance (cap - scans used in 2026-09), so nobody loses a
 * scan they paid for when the calendar reset goes away. The old code resets the
 * counter at Oct 1 00:00 UTC (8pm ET on Sep 30), so the month is fixed here
 * instead of read from the clock: the answer is the same before and after the
 * flip. A row already rolled to October by the old code (its September count
 * overwritten) reads as no September use, so it seeds the full allowance (the
 * safe side); the script can do better from scan_usage.
 *
 * The seed is written once per user: ledger key `migration:<userId>`.
 */

/** The last calendar month the old rules metered. */
export const SEED_MONTH = "2026-09";
/** After this instant the lazy seed stops (a deploy-day safety net, not a permanent path): 2026-11-01 00:00 UTC. */
export const SEED_WINDOW_ENDS_AT = Date.UTC(2026, 10, 1);
/** Only invoices PAID from here on are credited by the reconcile job; anything earlier is what the seed already stands for (2026-10-01 00:00 UTC). */
export const CREDITS_FROM = Date.UTC(2026, 9, 1);

export const seedKey = (userId: string) => `migration:${userId}`;

/** Scans left of the seed month's allowance: `cap` minus what the counter says was used in SEED_MONTH. */
export function seedAmount(cap: number, scanMonth: string | null | undefined, scansUsed: number | null | undefined): number {
  const used = scanMonth === SEED_MONTH ? Math.max(0, scansUsed ?? 0) : 0;
  return Math.max(0, cap - used);
}
