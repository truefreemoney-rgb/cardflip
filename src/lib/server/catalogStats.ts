import "server-only";
import { db } from "@/lib/db";

/**
 * How many printings the local mirrors hold, for the landing-page stat —
 * the number used to be a hardcoded "20,000+" from the Pokémon-only days
 * and went stale the moment the Scryfall mirror (94k printings) landed.
 * Counted once per process: the mirrors only change on a sync/deploy.
 */
let cached: { total: number; at: number } | null = null;
const TTL_MS = 60 * 60 * 1000;

async function count(table: string): Promise<number> {
  try {
    const row = (await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()) as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export async function catalogSize(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.total;
  const total = (await count("en_cards")) + (await count("jp_cards")) + (await count("zh_cards")) + (await count("mtg_cards"));
  cached = { total, at: now };
  return total;
}

/** "115,000+" — rounded down to a clean marketing figure, never over-claimed. */
export async function catalogSizeLabel(): Promise<string> {
  const n = await catalogSize();
  if (n <= 0) return "Every printing";
  const step = n >= 100_000 ? 5_000 : n >= 10_000 ? 1_000 : 100;
  const floored = Math.floor(n / step) * step;
  return `${floored.toLocaleString("en-US")}+`;
}
