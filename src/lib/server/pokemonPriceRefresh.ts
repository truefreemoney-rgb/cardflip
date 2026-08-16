import { db } from "@/lib/db";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
import { tcgplayerVariantKey } from "@/lib/tcgcsv";

/**
 * Daily Pokémon price points from TCGCSV (tcgcsv.com — TCGplayer's prices,
 * republished daily as plain JSON per set). Uses the productId → card map
 * that scripts/backfill-tcgcsv.mjs built (`tcgplayer_products`, shipped in
 * the seed), so every mapped card gets today's point in one pass of ~150
 * small requests — no pokemontcg.io involved, which fails half its calls.
 * Same compact price_series rows and 50¢ rule as everything else.
 */

const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip-superior.fly.dev)" };
const MIN_TRACKED_USD = 0.5;
const PAUSE_MS = 80;

db.exec(`
  CREATE TABLE IF NOT EXISTS tcgplayer_products (
    product_id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    game TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tcgplayer_products_group ON tcgplayer_products(group_id);
`);

export interface PokemonRefreshResult {
  groups: number;
  groupsFailed: number;
  seriesTouched: number;
  day: string;
}

export function hasTcgplayerMap(): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM tcgplayer_products LIMIT 1").get();
  return Boolean(row);
}

export async function refreshPokemonPricesFromTcgcsv(day = todayUtc()): Promise<PokemonRefreshResult> {
  const groups = (db.prepare("SELECT DISTINCT group_id FROM tcgplayer_products WHERE game = 'pokemon'").all() as { group_id: number }[])
    .map((r) => r.group_id);
  const productToCard = new Map<number, string>();
  for (const r of db.prepare("SELECT product_id, card_id FROM tcgplayer_products WHERE game = 'pokemon'").iterate() as Iterable<{ product_id: number; card_id: string }>) {
    productToCard.set(r.product_id, r.card_id);
  }
  const selectRow = db.prepare("SELECT start_day, prices FROM price_series WHERE card_id = ? AND variant = ? AND source = 'tcgplayer'");
  const upsertRow = db.prepare(
    `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
     VALUES (?, 'pokemon', ?, 'tcgplayer', 'USD', ?, ?, ?)`,
  );

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
    db.exec("BEGIN");
    try {
      for (const r of results) {
        const cardId = productToCard.get(r.productId);
        const price = r.marketPrice ?? null;
        if (!cardId || price == null || !(price > 0)) continue;
        const variant = tcgplayerVariantKey(r.subTypeName);
        const existing = selectRow.get(cardId, variant) as { start_day: string; prices: string } | undefined;
        if (!existing && price < MIN_TRACKED_USD) continue;
        const next = setDay(existing ? { startDay: existing.start_day, prices: decodePrices(existing.prices) } : null, day, price);
        upsertRow.run(cardId, variant, next.startDay, encodePrices(next.prices), day);
        seriesTouched++;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  return { groups: groups.length, groupsFailed, seriesTouched, day };
}
