import { TCGCSV_HEADERS, tcgcsvFetch } from "@/lib/server/tcgcsv";
import { db } from "@/lib/db";
import {
  GROUP_IDS,
  isArtSeriesSet,
  matchGroup,
  matchMtgProducts,
  pos,
  pricedProducts,
  type MtgFill,
  type MtgGapRow,
  type TcgGroup,
  type TcgProduct,
  type TcgcsvPrice,
  type TcgcsvProduct,
} from "@/lib/mtgTcgplayerMatch";

/**
 * Magic printings Scryfall's bulk file leaves without a dollar price (10-05:
 * ~4,050 released English rows — 2,601 Art Series cards, Alpha/Beta, Summer
 * Magic, the Zeta Set, 8th/9th Edition foil ★ cards, The List, Secret Lair
 * one-offs) take TCGplayer's price from tcgcsv.com category 1. The matching
 * itself is lib/mtgTcgplayerMatch.ts (pure, shared with scripts/sync-mtg-art.mjs
 * for the gold-stamped twins); this file adds the tcgcsv fetches, the mirror
 * reads and the 15× guard. No "server-only": scripts drive it too.
 */
export { ASKING_MAX_USD, askingPrice, isSerial, isStampedProduct, matchGroup, matchMtgProducts, pricedProducts, tcgplayerScanUrl } from "@/lib/mtgTcgplayerMatch";
export type { MtgFill, MtgGapRow, TcgGroup, TcgProduct } from "@/lib/mtgTcgplayerMatch";

const API = "https://tcgcsv.com/tcgplayer/1";
const UA = TCGCSV_HEADERS;

const listOf = <T>(j: unknown): T[] => ((j as { results?: T[] })?.results ?? []) as T[];
const getJson = async (url: string) => {
  const r = await tcgcsvFetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};
/** One TCGplayer group's products with a price (market, else mid — the Yu-Gi-Oh sync rule). */
export async function groupProducts(groupId: number): Promise<TcgProduct[]> {
  const products = listOf<TcgcsvProduct>(await getJson(`${API}/${groupId}/products`));
  const prices = listOf<TcgcsvPrice>(await getJson(`${API}/${groupId}/prices`));
  return pricedProducts(products, prices);
}

/** A printing's cheapest live listing and its middle listing price (TCGplayer's lowPrice / midPrice, item only, no shipping). */
export interface ListingSpread {
  low: number;
  mid: number | null;
}

/**
 * Every Magic product's cheapest and middle live listing, by TCGplayer product id then subtype ("Normal" / "Foil"): one
 * tcgcsv pass over all ~460 groups (~60 s on 10-13). The daily cap and the trust check read it (mtgPriceRefresh capToListing).
 */
export async function allListingLows(): Promise<Map<number, Record<string, ListingSpread>>> {
  const groups = listOf<TcgGroup>(await getJson(`${API}/groups`));
  const out = new Map<number, Record<string, ListingSpread>>();
  const queue = [...groups];
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        for (const p of listOf<{ productId: number; subTypeName?: string; lowPrice?: unknown; midPrice?: unknown }>(await getJson(`${API}/${g.groupId}/prices`))) {
          const low = pos(p.lowPrice);
          if (low != null) out.set(p.productId, { ...(out.get(p.productId) ?? {}), [p.subTypeName ?? "Normal"]: { low, mid: pos(p.midPrice) } });
        }
      } catch (err) {
        console.warn(`mtg listing lows group ${g.groupId}:`, err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  return out;
}

/** Gap rows (ids given) with their set details, read from the mirror. */
export async function readMtgGapRows(ids: string[]): Promise<MtgGapRow[]> {
  const out: MtgGapRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = (await db
      .prepare(`SELECT id, oracle_id, name, set_code, set_name, collector_number, finishes, set_release_date FROM mtg_cards WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk)) as { id: string; oracle_id: string | null; name: string; set_code: string; set_name: string; collector_number: string; finishes: string | null; set_release_date: string | null }[];
    for (const r of rows)
      out.push({ id: r.id, name: r.name, setCode: r.set_code, setName: r.set_name, number: r.collector_number, finishes: r.finishes ?? "", oracleId: r.oracle_id, released: r.set_release_date ?? "" });
  }
  return out;
}

/** Dearest dollar price among a card's other (non-Art-Series) printings, per oracle id. */
export async function readOracleMaxUsd(oracleIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < oracleIds.length; i += 500) {
    const chunk = oracleIds.slice(i, i + 500);
    const rows = (await db
      .prepare(`SELECT oracle_id, MAX(MAX(COALESCE(price_usd, 0)), MAX(COALESCE(price_usd_foil, 0)), MAX(COALESCE(price_usd_etched, 0))) AS m
        FROM mtg_cards WHERE oracle_id IN (${chunk.map(() => "?").join(",")}) AND set_name NOT LIKE '%Art Series' GROUP BY oracle_id`)
      .all(...chunk)) as { oracle_id: string; m: number }[];
    for (const r of rows) if (Number(r.m) > 0) out.set(r.oracle_id, Number(r.m));
  }
  return out;
}

/**
 * Pure: drop a fill priced over 15× every other printing of the same card
 * (and over $20). 10-05 dry run: TCGplayer had Alpha Veteran Bodyguard at
 * $6,495 vs $112 elsewhere, a one-off (likely graded) sale. Blank beats wrong.
 */
export function guardFills(fills: MtgFill[], rows: MtgGapRow[], oracleMax: Map<string, number>): MtgFill[] {
  const oracle = new Map(rows.map((r) => [r.id, r.oracleId ?? ""]));
  // An art card is its own product: the spell it pictures is no reference for it (10-29: Avatar gold-stamped art
  // cards sell at $75-165 over a $2 spell). The nightly eBay referee still reviews every $100+ price.
  const artRows = new Set(rows.filter((r) => isArtSeriesSet(r.setName ?? "")).map((r) => r.id));
  return fills.filter((f) => {
    if (f.serial || artRows.has(f.id)) return true; // 10-13: serial Bitterbloom Bearer $3,997 vs $31 normal; eBay sold $3,300-$4,239
    const p = Math.max(f.usd ?? 0, f.foil ?? 0);
    const ref = oracleMax.get(oracle.get(f.id) ?? "") ?? 0;
    return !(ref > 0 && p > 20 && p > 15 * ref);
  });
}

/** Live: gap rows → TCGplayer fills, fetching only the groups the gaps need. */
export async function tcgplayerFills(rows: MtgGapRow[]): Promise<{ fills: MtgFill[]; groups: number; unmatchedSets: string[]; dropped: number }> {
  const groups = listOf<TcgGroup>(await getJson(`${API}/groups`));
  const bySet = new Map<string, MtgGapRow[]>();
  for (const r of rows) bySet.set(r.setCode, [...(bySet.get(r.setCode) ?? []), r]);
  const work: { groupIds: number[]; rows: MtgGapRow[] }[] = [];
  const unmatchedSets: string[] = [];
  for (const [code, list] of bySet) {
    const ids = GROUP_IDS[code.toLowerCase()];
    const g = ids ? null : matchGroup(code, list[0].setName, groups);
    if (ids) work.push({ groupIds: ids, rows: list });
    else if (g) work.push({ groupIds: [g.groupId], rows: list });
    else unmatchedSets.push(`${code} ${list[0].setName} (${list.length})`);
  }
  const fills: MtgFill[] = [];
  const queue = [...work];
  const worker = async () => {
    for (let w = queue.shift(); w; w = queue.shift()) {
      try {
        const products: TcgProduct[] = [];
        for (const id of w.groupIds) products.push(...(await groupProducts(id)));
        fills.push(...matchMtgProducts(w.rows, products));
      } catch (err) {
        console.warn(`mtg tcgplayer group ${w.groupIds.join("+")}:`, err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  const oracleIds = [...new Set(rows.map((r) => r.oracleId).filter((o): o is string => !!o))];
  const guarded = guardFills(fills, rows, oracleIds.length ? await readOracleMaxUsd(oracleIds) : new Map());
  return { fills: guarded, groups: work.length, unmatchedSets, dropped: fills.length - guarded.length };
}
