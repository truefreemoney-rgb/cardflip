import "server-only";
import { db } from "@/lib/db";
import { cachedList } from "@/lib/server/listCache";
import { catalogSize } from "@/lib/server/catalogStats";

/**
 * The real numbers behind the "site is alive" strip on the home and /scan
 * pages (10-06, Chris: "something at the top that shows it's busy"). Every
 * figure is a live count, never a made-up or scheduled one:
 *   cards      — printings in the catalog mirrors, all five games (catalogSize, the same count the "N+ cards" lines round down)
 *   prices     — distinct cards whose price the last two days' runs wrote
 *   updatedAt  — when the daily price run last finished (daily_finished_at)
 * The two counts walk ~250k rows, so they're taken once per Eastern day and
 * shared through card_cache; the finish time is one cheap meta read.
 */
export interface LiveStats {
  cards: number;
  prices: number;
  updatedAt: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function count(sql: string): Promise<number> {
  try {
    const row = (await db.prepare(sql).get()) as { c: number } | undefined;
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

function easternDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

export async function liveStats(now = Date.now()): Promise<LiveStats> {
  const counts = await cachedList(`seo:livestats:v3:${easternDay(now)}`, DAY_MS, async () => ({
    cards: await catalogSize().catch(() => 0),
    // Distinct cards, not series (10-06, Chris: one card has a series per version and per source, so the series count
    // read as "more prices than cards"). Never larger than the catalog count beside it.
    prices: await count("SELECT COUNT(DISTINCT card_id) AS c FROM price_series WHERE updated_day >= date('now', '-1 day')"),
  })).catch(() => ({ cards: 0, prices: 0 }));
  let updatedAt: number | null = null;
  try {
    const row = (await db.prepare("SELECT value FROM price_history_meta WHERE key = 'daily_finished_at'").get()) as { value: string } | undefined;
    updatedAt = Number(row?.value) || null;
  } catch {
    // No stamp: the strip leaves the time off rather than guessing one.
  }
  return { ...counts, updatedAt };
}
