import "server-only";
import { db } from "@/lib/db";
import { todayUtc } from "@/lib/priceSeries";

/**
 * Durable per-day budgets, backed by counter rows in price_history_meta
 * (`<name>_<YYYY-MM-DD>`). This is the pattern that fixed the PSA quota leak
 * (09-02): on serverless an in-memory daily window resets with every cold
 * start and doesn't span instances, so it never actually binds. Anything
 * that guards money (PSA's 100/day tier, Anthropic vision spend) counts here
 * instead; the in-memory limiter in rateLimit.ts stays as the per-minute
 * burst guard, which warm instances handle well enough.
 *
 * The hit is counted before the caller does the expensive work, so failures
 * still consume budget — fine for a protective cap, wrong for user-facing
 * metering (that's scanQuota.ts).
 */
export async function dayBudgetSpent(name: string, budget: number): Promise<boolean> {
  const key = `${name}_${todayUtc()}`;
  await sweepOldKeys(name);
  await db
    .prepare(
      `INSERT INTO price_history_meta (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
    )
    .run(key);
  const row = (await db.prepare("SELECT value FROM price_history_meta WHERE key = ?").get(key)) as
    | { value: string }
    | undefined;
  return Number(row?.value ?? 0) > budget;
}

// Drop a name's counters older than a week, once per process per name, so
// per-user names (scan_<id>) don't accrete a row per user per day forever.
// ISO days compare correctly as strings.
const sweptNames = new Set<string>();

async function sweepOldKeys(name: string): Promise<void> {
  if (sweptNames.has(name)) return;
  sweptNames.add(name);
  const cutoff = todayUtc(Date.now() - 7 * 24 * 60 * 60 * 1000);
  try {
    // Range compare instead of LIKE: `_` is a LIKE wildcard, and the lexical
    // range `<name>_2000-01-01 .. <name>_<cutoff>` can only contain this
    // name's own date-suffixed keys.
    await db
      .prepare("DELETE FROM price_history_meta WHERE key >= ? AND key < ?")
      .run(`${name}_2000-01-01`, `${name}_${cutoff}`);
  } catch {
    // Sweeping is hygiene, not correctness — never fail the caller over it.
  }
}
