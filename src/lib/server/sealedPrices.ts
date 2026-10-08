import "server-only";
import { db } from "@/lib/db";
import { decodePrices, encodePrices, setDay, todayUtc, addDays } from "@/lib/priceSeries";
import type { SeriesKeyed, SeriesUpsert } from "@/lib/server/priceBulkWrite";
import { latestUsdPrices } from "@/lib/server/priceHistory";
import { productNumber } from "@/lib/tcgcsv";
import { classifySealedProduct, median, sealedProductId, sealedProductRole, sealedTcgplayerId, type SealedRole } from "@/lib/sealedProducts";
import type { GameId } from "@/lib/types";

/**
 * Sealed product price feed (Tier 2 #13, 09-27).
 *
 * Two halves. scanSealedProducts reads a group's TCGplayer product list and
 * keeps every row without a collector number that names a kind we sell
 * (lib/sealedProducts.ts classifySealedProduct) in `tcgplayer_sealed`, a
 * few groups per daily run so it never costs the price refresh its time
 * budget (a group is rescanned monthly for new tins). sealedSeriesUpserts
 * then turns the per-group /prices results the card refresh already fetched
 * into price_series rows: one per TCGplayer product (tcgp-sealed-<id>) and
 * one per (set, kind) under the sealed catalog id the ledger row carries —
 * the median when a set has several of a kind (three tins, two blisters).
 */

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; CardFlip/1.0; +https://cardflip.io)" };
const PAUSE_MS = 80;
export const SEALED_RESCAN_DAYS = 30;
/** Groups read per daily run: ~0.3s each, so the whole catalog lands within a week. */
export const SEALED_GROUPS_PER_RUN = 30;
/**
 * The very first run (no group scanned yet) reads the whole catalog in one
 * go (~150 groups ≈ 1 min) so the feed is full the day it ships instead of
 * a week later. After that the daily pace applies.
 */
export const SEALED_FIRST_FILL_GROUPS = 400;
const MIN_TRACKED_USD = 0.05;

export interface SealedScanResult {
  groupsScanned: number;
  groupsFailed: number;
  products: number;
}

/** The set each TCGplayer group is, by where most of its mapped cards live. */
async function groupSetNames(game: GameId): Promise<Map<number, string>> {
  const table = game === "pokemon" ? "en_cards" : "mtg_cards";
  const rows = (await db
    .prepare(
      `SELECT tp.group_id, e.set_name, COUNT(*) AS n
         FROM tcgplayer_products tp JOIN ${table} e ON e.id = tp.card_id
        WHERE tp.game = ?
        GROUP BY tp.group_id, e.set_name`,
    )
    .all(game)) as unknown as { group_id: number; set_name: string; n: number }[];
  const best = new Map<number, { set: string; n: number }>();
  for (const r of rows) {
    const have = best.get(r.group_id);
    if (!have || r.n > have.n) best.set(r.group_id, { set: r.set_name, n: r.n });
  }
  return new Map([...best].map(([g, v]) => [g, v.set]));
}

/** Groups never scanned, or scanned more than SEALED_RESCAN_DAYS ago, oldest first. */
export async function sealedGroupsDue(game: GameId, day: string, limit: number): Promise<number[]> {
  const cutoff = addDays(day, -SEALED_RESCAN_DAYS);
  const rows = (await db
    .prepare(
      `SELECT DISTINCT tp.group_id, g.scanned_day
         FROM tcgplayer_products tp LEFT JOIN tcgplayer_sealed_groups g ON g.group_id = tp.group_id
        WHERE tp.game = ? AND (g.scanned_day IS NULL OR g.scanned_day < ?)
        ORDER BY g.scanned_day IS NOT NULL, g.scanned_day, tp.group_id DESC
        LIMIT ?`,
    )
    .all(game, cutoff, limit)) as unknown as { group_id: number }[];
  return rows.map((r) => Number(r.group_id));
}

type TcgProduct = { productId: number; name?: string; extendedData?: { name: string; value: string }[] };

/** Keep a group's sealed rows from a product list; returns how many were stored. */
export async function storeSealedProducts(
  game: GameId,
  groupId: number,
  setName: string,
  products: TcgProduct[],
  day: string,
): Promise<number> {
  let stored = 0;
  for (const p of products) {
    if (!p.name || productNumber(p) !== null) continue;
    const type = classifySealedProduct(p.name);
    const role = sealedProductRole(p.name);
    if (!type || role === "lot") continue;
    await db
      .prepare(
        `INSERT OR REPLACE INTO tcgplayer_sealed (product_id, group_id, game, set_name, name, product_type, role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.productId, groupId, game, setName, p.name.slice(0, 160), type, role);
    stored++;
  }
  await db
    .prepare("INSERT OR REPLACE INTO tcgplayer_sealed_groups (group_id, scanned_day) VALUES (?, ?)")
    .run(groupId, day);
  return stored;
}

/**
 * Read the product lists of up to `limit` due groups. Pokémon only for now
 * (the MTG map has no sealed rows to price against yet).
 */
export async function scanSealedProducts(
  day = todayUtc(),
  limit = SEALED_GROUPS_PER_RUN,
  fetchProducts: (groupId: number) => Promise<TcgProduct[]> = fetchGroupProducts,
): Promise<SealedScanResult> {
  const game: GameId = "pokemon";
  if (limit === SEALED_GROUPS_PER_RUN) {
    const scanned = (await db.prepare("SELECT COUNT(*) AS n FROM tcgplayer_sealed_groups").get()) as { n: number } | undefined;
    if (!Number(scanned?.n)) limit = SEALED_FIRST_FILL_GROUPS;
  }
  const due = await sealedGroupsDue(game, day, limit);
  if (due.length === 0) return { groupsScanned: 0, groupsFailed: 0, products: 0 };
  const setOf = await groupSetNames(game);
  let failed = 0;
  let products = 0;
  for (const gid of due) {
    const setName = setOf.get(gid);
    if (!setName) {
      // A group with no card of ours mapped can't be named; mark it so it
      // is not retried daily.
      await db.prepare("INSERT OR REPLACE INTO tcgplayer_sealed_groups (group_id, scanned_day) VALUES (?, ?)").run(gid, day);
      continue;
    }
    try {
      const list = await fetchProducts(gid);
      products += await storeSealedProducts(game, gid, setName, list, day);
    } catch (err) {
      failed++;
      console.warn(`tcgcsv sealed products ${gid}:`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  return { groupsScanned: due.length - failed, groupsFailed: failed, products };
}

async function fetchGroupProducts(groupId: number): Promise<TcgProduct[]> {
  const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`, { headers: HEADERS });
  if (!res.ok) throw new Error(`products HTTP ${res.status}`);
  return ((await res.json()) as { results?: TcgProduct[] }).results ?? [];
}

export interface SealedMapRow {
  product_id: number;
  set_name: string;
  product_type: string;
  role: SealedRole;
}

/** productId → (set, kind, role) for every classified sealed product of a game. */
export async function readSealedMap(game: GameId): Promise<Map<number, SealedMapRow>> {
  const rows = (await db
    .prepare("SELECT product_id, set_name, product_type, role FROM tcgplayer_sealed WHERE game = ? AND product_type IS NOT NULL")
    .all(game)) as unknown as SealedMapRow[];
  return new Map(rows.map((r) => [Number(r.product_id), r]));
}

/**
 * Series rows for one day's sealed prices. `prices` is productId → market
 * (the first priced subtype seen per product); `existing` is the family
 * map the card refresh already read, keyed `${cardId}|${variant}`.
 */
export function sealedSeriesUpserts(
  game: GameId,
  day: string,
  prices: Map<number, number>,
  sealedMap: Map<number, SealedMapRow>,
  existing: Map<string, SeriesKeyed>,
): SeriesUpsert[] {
  const out: SeriesUpsert[] = [];
  // Per (set, kind): the standard products' prices, and the exclusives'
  // as the fallback when a kind only comes as an exclusive.
  const perKind = new Map<string, { standard: number[]; exclusive: number[] }>();
  const point = (cardId: string, price: number) => {
    const key = `${cardId}|normal`;
    const have = existing.get(key);
    if (!have && price < MIN_TRACKED_USD) return;
    const next = setDay(have ? { startDay: have.startDay, prices: decodePrices(have.prices) } : null, day, price);
    out.push({
      cardId, game, variant: "normal", source: "tcgplayer", currency: "USD",
      startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day,
    });
  };
  for (const [productId, price] of prices) {
    const row = sealedMap.get(productId);
    if (!row || !(price > 0)) continue;
    point(sealedTcgplayerId(productId), price);
    const id = sealedProductId(game, row.set_name, row.product_type);
    let kind = perKind.get(id);
    if (!kind) perKind.set(id, (kind = { standard: [], exclusive: [] }));
    (row.role === "exclusive" ? kind.exclusive : kind.standard).push(price);
  }
  for (const [id, kind] of perKind) {
    const m = median(kind.standard.length > 0 ? kind.standard : kind.exclusive);
    if (m != null) point(id, m);
  }
  return out;
}

export interface SealedQuote {
  /** Median market of the set's standard products of this kind, or null when the feed has none. */
  market: number | null;
  /** Standard products first, then exclusives, each with its own price. */
  products: { productId: number; name: string; market: number | null; exclusive: boolean }[];
}

/** What the feed knows about one (set, kind): the median plus each TCGplayer product's own price. */
export async function sealedQuote(game: GameId, setName: string, productType: string): Promise<SealedQuote> {
  const rows = (await db
    .prepare("SELECT product_id, name, role FROM tcgplayer_sealed WHERE game = ? AND set_name = ? AND product_type = ? ORDER BY role = 'exclusive', name")
    .all(game, setName, productType)) as unknown as { product_id: number; name: string; role: SealedRole }[];
  const id = sealedProductId(game, setName, productType);
  const latest = await latestUsdPrices([id, ...rows.map((r) => sealedTcgplayerId(Number(r.product_id)))]);
  return {
    market: latest.get(id)?.price ?? null,
    products: rows.map((r) => ({
      productId: Number(r.product_id),
      name: r.name,
      market: latest.get(sealedTcgplayerId(Number(r.product_id)))?.price ?? null,
      exclusive: r.role === "exclusive",
    })),
  };
}
