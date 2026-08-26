import { db } from "@/lib/db";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
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
  const SELECT_ROW = "SELECT start_day, prices FROM price_series WHERE card_id = ? AND variant = ? AND source = 'tcgplayer'";
  const UPSERT_ROW = `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
     VALUES (?, 'pokemon', ?, 'tcgplayer', 'USD', ?, ?, ?)`;

  let seriesTouched = 0, groupsFailed = 0;
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
    // One short transaction per set keeps the write lock brief.
    await db.transaction(async (tx) => {
      const selectRow = tx.prepare(SELECT_ROW);
      const upsertRow = tx.prepare(UPSERT_ROW);
      for (const r of results) {
        const cardId = productToCard.get(r.productId);
        const price = r.marketPrice ?? null;
        if (!cardId || price == null || !(price > 0)) continue;
        const variant = tcgplayerVariantKey(r.subTypeName);
        const existing = (await selectRow.get(cardId, variant)) as { start_day: string; prices: string } | undefined;
        if (!existing && price < MIN_TRACKED_USD) continue;
        const next = setDay(existing ? { startDay: existing.start_day, prices: decodePrices(existing.prices) } : null, day, price);
        await upsertRow.run(cardId, variant, next.startDay, encodePrices(next.prices), day);
        seriesTouched++;
      }
    });
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  return { groups: groups.length, groupsFailed, seriesTouched, day };
}
