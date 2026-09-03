import { db } from "@/lib/db";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
import { readSeriesMap, upsertSeriesRows, type SeriesUpsert } from "@/lib/server/priceBulkWrite";
import { tcgplayerVariantKey } from "@/lib/tcgcsv";

/**
 * Daily Pokémon price points from TCGCSV (tcgcsv.com — TCGplayer's prices,
 * republished daily as plain JSON per set). Uses the productId → card map
 * that scripts/backfill-tcgcsv.mjs built (`tcgplayer_products`, shipped in
 * the seed), so every mapped card gets today's point in one pass of ~150
 * small requests — no pokemontcg.io involved, which fails half its calls.
 * Same compact price_series rows and 5¢ rule as everything else.
 */

const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip-superior.fly.dev)" };
const MIN_TRACKED_USD = 0.05;
const PAUSE_MS = 80;

// Schema (tcgplayer_products) lives in lib/db.ts behind the adapter's schema gate.

export interface PokemonRefreshResult {
  groups: number;
  groupsFailed: number;
  seriesTouched: number;
  day: string;
}

export async function hasTcgplayerMap(): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM tcgplayer_products LIMIT 1").get();
  return Boolean(row);
}

export async function refreshPokemonPricesFromTcgcsv(day = todayUtc()): Promise<PokemonRefreshResult> {
  const groups = ((await db.prepare("SELECT DISTINCT group_id FROM tcgplayer_products WHERE game = 'pokemon'").all()) as { group_id: number }[])
    .map((r) => r.group_id);
  const productToCard = new Map<number, string>();
  // The sync driver streamed this with .iterate(); the map is ~30k small rows,
  // well within memory as one read.
  for (const r of (await db.prepare("SELECT product_id, card_id FROM tcgplayer_products WHERE game = 'pokemon'").all()) as { product_id: number; card_id: string }[]) {
    productToCard.set(r.product_id, r.card_id);
  }
  // One bulk read of the whole family, all diffs computed in memory, one
  // batched write-back at the end — per-row SELECT+UPSERT was ~60k Turso
  // round trips and timed out Vercel's function limit (08-26).
  const existingSeries = await readSeriesMap("pokemon", "tcgplayer");

  let groupsFailed = 0;
  const upserts: SeriesUpsert[] = [];
  const touched = new Set<string>();
  for (const gid of groups) {
    let results: { productId: number; marketPrice?: number | null; subTypeName?: string | null }[];
    try {
      const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/prices`, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      results = ((await res.json()) as { results?: typeof results }).results ?? [];
    } catch (err) {
      groupsFailed++;
      console.warn(`tcgcsv group ${gid}:`, err instanceof Error ? err.message : err);
      continue;
    }
    for (const r of results) {
      const cardId = productToCard.get(r.productId);
      const price = r.marketPrice ?? null;
      if (!cardId || price == null || !(price > 0)) continue;
      const variant = tcgplayerVariantKey(r.subTypeName);
      const key = `${cardId}|${variant}`;
      if (touched.has(key)) continue;
      const existing = existingSeries.get(key);
      if (!existing && price < MIN_TRACKED_USD) continue;
      const next = setDay(existing ? { startDay: existing.startDay, prices: decodePrices(existing.prices) } : null, day, price);
      upserts.push({
        cardId, game: "pokemon", variant, source: "tcgplayer", currency: "USD",
        startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day,
      });
      touched.add(key);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  await upsertSeriesRows(upserts);
  return { groups: groups.length, groupsFailed, seriesTouched: upserts.length, day };
}
