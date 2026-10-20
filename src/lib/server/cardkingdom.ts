/**
 * Card Kingdom (cardkingdom.com) as a Magic price source for printings TCGplayer, then Cardmarket, leave blank (chain step 4,
 * lib/priceChain.ts). Its official public price list (https://api.cardkingdom.com/api/pricelist, ~47 MB JSON, one row per
 * printing and finish, keyed by Scryfall id) is a shop's own retail price: measured 10-19 at 1.22-1.32x TCGplayer market,
 * so it is stored divided by CARD_KINGDOM_DIVISOR under source "cardkingdom" and labelled "Card Kingdom (adjusted)".
 * Traps: an out-of-stock row can carry a placeholder (The Mind Stone foil $45,000 with 0 in stock, 10-19 dry run), so a
 * $100+ price with nothing in stock is skipped, and the caller runs the fills through the same 15x oracle guard as
 * CardTrader's (mtgTcgplayerFill.guardFills). No "server-only": tests import the pure parts.
 */
import { CARD_KINGDOM_DIVISOR, CARD_KINGDOM_SOURCE } from "@/lib/priceChain";
import type { MtgPriceRow } from "@/lib/server/priceBulkWrite";

export const CARD_KINGDOM_URL = "https://api.cardkingdom.com/api/pricelist";
const UA = { "User-Agent": "CardFlip/1.0 (support@cardflip.io)" };
const MIN_USD = 0.05;
/** From this retail price up, a row with nothing in stock is a placeholder, not a price. */
export const OUT_OF_STOCK_MAX_USD = 100;

/** One printing's retail prices and stock by finish, in Card Kingdom's own dollars (not yet divided). */
export interface CkPrices {
  plain: number | null;
  foil: number | null;
  plainQty: number;
  foilQty: number;
}

interface CkRow {
  scryfall_id?: string | null;
  is_foil?: string | boolean;
  price_retail?: string | number;
  qty_retail?: string | number;
}

/** Pure: the list's rows -> retail by Scryfall id. A row without a Scryfall id or a positive retail price is skipped. */
export function cardkingdomMap(rows: readonly CkRow[]): Map<string, CkPrices> {
  const out = new Map<string, CkPrices>();
  for (const r of rows) {
    const id = typeof r.scryfall_id === "string" ? r.scryfall_id : "";
    const retail = Number(r.price_retail);
    if (!id || !(retail > 0)) continue;
    const foil = r.is_foil === true || r.is_foil === "true";
    const qty = Math.max(0, Number(r.qty_retail) || 0);
    const cur = out.get(id) ?? { plain: null, foil: null, plainQty: 0, foilQty: 0 };
    if (foil) {
      cur.foil = retail;
      cur.foilQty = qty;
    } else {
      cur.plain = retail;
      cur.plainQty = qty;
    }
    out.set(id, cur);
  }
  return out;
}

/** Card Kingdom retail -> a TCGplayer-level dollar figure, rounded to the cent; null when nothing usable or an out-of-stock placeholder. */
export function adjustedUsd(retail: number | null | undefined, qty = 1): number | null {
  if (retail == null || !(retail > 0)) return null;
  if (qty <= 0 && retail >= OUT_OF_STOCK_MAX_USD) return null;
  const usd = Math.round((retail / CARD_KINGDOM_DIVISOR) * 100) / 100;
  return usd >= MIN_USD ? usd : null;
}

/** Pure: what the list offers for one blank printing, adjusted; null when nothing usable. */
export function cardkingdomFill(id: string, list: Map<string, CkPrices>): { id: string; usd: number | null; foil: number | null } | null {
  const ck = list.get(id);
  if (!ck) return null;
  const usd = adjustedUsd(ck.plain, ck.plainQty);
  const foil = adjustedUsd(ck.foil, ck.foilQty);
  return usd == null && foil == null ? null : { id, usd, foil };
}

/**
 * Pure: blank rows (no dollar price at all) in `released` take Card Kingdom's adjusted retail under the cardkingdom source;
 * returns how many. `guard` (the caller's 15x oracle guard) drops a fill before it lands. A row already priced by an
 * earlier chain step is never touched.
 */
export function cardkingdomFills(
  rows: MtgPriceRow[],
  list: Map<string, CkPrices>,
  released: ReadonlySet<string>,
  guard: (fills: { id: string; usd: number | null; foil: number | null }[]) => { id: string; usd: number | null; foil: number | null }[] = (f) => f,
): number {
  const blank = rows.filter((r) => r.usd == null && r.foil == null && r.etched == null && released.has(r.id));
  const fills = guard(blank.map((r) => cardkingdomFill(r.id, list)).filter((f): f is NonNullable<typeof f> => f != null));
  const byId = new Map(blank.map((r) => [r.id, r]));
  let n = 0;
  for (const f of fills) {
    const r = byId.get(f.id);
    if (!r) continue;
    r.usd = f.usd;
    r.foil = f.foil;
    r.source = CARD_KINGDOM_SOURCE;
    n++;
  }
  return n;
}

/** The public list, parsed into cardkingdomMap. ~47 MB; capped at 90 s. */
export async function fetchCardkingdomList(): Promise<Map<string, CkPrices>> {
  const r = await fetch(CARD_KINGDOM_URL, { headers: UA, signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`card kingdom pricelist: HTTP ${r.status}`);
  const body = (await r.json()) as { data?: CkRow[] } | CkRow[];
  return cardkingdomMap(Array.isArray(body) ? body : (body.data ?? []));
}
