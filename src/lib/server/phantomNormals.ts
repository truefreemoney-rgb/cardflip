import { decodePrices } from "@/lib/priceSeries";
import { lastPriced } from "@/lib/server/priceTrust";
import { getSetting, setSetting } from "@/lib/server/settings";
import { TCGCSV_HEADERS } from "@/lib/server/tcgcsv";
import type { SeriesUpsert } from "@/lib/server/priceBulkWrite";
import type { PatternVariant } from "@/lib/tcgcsv";
import type { CardPrice } from "@/lib/types";

/**
 * Phantom "normal" printings (10-24): a holo-only card (an EX-era holo rare or ex, a Call of Legends energy) whose one
 * TCGplayer product also lists a "Normal" printing, priced from the odd holo a seller filed under it. Regice ex EM 98
 * printed "normal" $350 over its holo's $299.99 (one "Normal" sale), Marowak FRLG 7 $133.74 over $37.61, and "normal" is
 * the printing every screen shows first (lib/variantOrder.ts). Measured 10-24 on the local mirror: 236 cards carry both
 * lines, TCGdex says 97 of them were never printed without holo, and TCGplayer's own sales agree (Gyarados DX 8: 5
 * "Normal" sales of 47, at holo prices; Rocket's Mewtwo ex, Regice ex, Rayquaza ex DX 102: one each). The MEP promos
 * are the other shape and keep their line: a plain product filed as Normal (~100 sales, the card's real price) beside
 * a separate stamped Holofoil product. So a card's "normal" goes only when ONE product lists both printings and
 * TCGdex says holo only, and only while the card keeps a priced holo line.
 */

/** cardId → the day TCGdex confirmed the card holo only (its "normal" line is a mislabel). */
export const PHANTOM_NORMAL_KEY = "pokemon_phantom_normal";
/** cardId → the last day TCGdex's printings were asked for a suspect; asked again after ASK_AGAIN_DAYS. */
const PRINTINGS_ASKED_KEY = "pokemon_printings_asked";
const ASK_AGAIN_DAYS = 30;

/**
 * Pure: cards one product lists as both "Normal" and "Holofoil" in today's TCGCSV file, priced or not (a printing
 * with no recent sale is still on TCGplayer's product). Pattern and stamped products never count; a 1st Edition
 * twin's product never writes a Normal line (pokemonPriceRefresh productSeries) and is skipped.
 */
export function normalBesideHolo(
  results: { productId: number; subTypeName?: string | null }[],
  productToCard: Map<number, string>,
  patternOf: Map<number, PatternVariant>,
  stamped: ReadonlySet<number> = new Set(),
): Set<string> {
  const subtypes = new Map<number, Set<string>>();
  for (const r of results) {
    if (!r.subTypeName || stamped.has(r.productId) || patternOf.has(r.productId)) continue;
    subtypes.set(r.productId, (subtypes.get(r.productId) ?? new Set<string>()).add(r.subTypeName));
  }
  const out = new Set<string>();
  for (const [productId, names] of subtypes) {
    const cardId = productToCard.get(productId);
    if (cardId && !cardId.endsWith("-1st") && names.has("Normal") && names.has("Holofoil")) out.add(cardId);
  }
  return out;
}

/**
 * Pure: cards with at most one product that already hold both a "normal" and a "holofoil" line: the same shape from an
 * earlier file. A product can drop its Normal printing and leave the line stale in front of the holo (Rocket's Mewtwo
 * ex TRR 99: "normal" $1,150 from 10-17 over the holo's $579.90). Two products is the MEP shape and never counts.
 */
export function storedNormalBesideHolo(existingKeys: Iterable<string>, cardProducts: Map<string, number>): Set<string> {
  const keys = new Set(existingKeys);
  const out = new Set<string>();
  for (const key of keys) {
    if (!key.endsWith("|normal")) continue;
    const cardId = key.slice(0, -"|normal".length);
    if (!cardId.endsWith("-1st") && (cardProducts.get(cardId) ?? 0) <= 1 && keys.has(`${cardId}|holofoil`)) out.add(cardId);
  }
  return out;
}

/** Pure: TCGdex's `variants` say the card was never printed without holo (normal false, holo true). Null = TCGdex didn't say. */
export function tcgdexHoloOnly(variants: unknown): boolean | null {
  if (!variants || typeof variants !== "object") return null;
  const { normal, holo } = variants as { normal?: unknown; holo?: unknown };
  if (typeof normal !== "boolean" || typeof holo !== "boolean") return null;
  return !normal && holo;
}

/**
 * Pure: today's upserts without a phantom card's "normal" line, and the phantom cards whose stored "normal" line goes.
 * Only for a card that keeps a priced holofoil line (today's or stored), so no card is left priceless.
 */
export function dropPhantomNormals(
  upserts: SeriesUpsert[],
  phantom: ReadonlySet<string>,
  existing: Map<string, { prices: string }>,
): { keep: SeriesUpsert[]; deletes: string[] } {
  if (phantom.size === 0) return { keep: upserts, deletes: [] };
  const holo = new Set(upserts.filter((u) => u.variant === "holofoil").map((u) => u.cardId));
  for (const id of phantom) {
    const s = existing.get(`${id}|holofoil`);
    if (s && lastPriced(decodePrices(s.prices)) != null) holo.add(id);
  }
  const gone = (id: string) => phantom.has(id) && holo.has(id);
  return {
    keep: upserts.filter((u) => !(u.variant === "normal" && gone(u.cardId))),
    deletes: [...phantom].filter((id) => gone(id) && existing.has(`${id}|normal`)),
  };
}

/**
 * The suspects (normalBesideHolo) TCGdex says are holo only. Asks TCGdex for the ones not asked in ASK_AGAIN_DAYS, up to
 * `max` a run, 6 at a time (~2 s per 300 cards, as tcgdexFill measured); a TCGdex miss changes nothing that day.
 */
export async function confirmPhantomNormals(suspects: ReadonlySet<string>, day: string, max = 400): Promise<Set<string>> {
  const phantom = JSON.parse((await getSetting(PHANTOM_NORMAL_KEY)) ?? "{}") as Record<string, string>;
  const asked = JSON.parse((await getSetting(PRINTINGS_ASKED_KEY)) ?? "{}") as Record<string, string>;
  const due = (id: string) => !asked[id] || Date.parse(day) - Date.parse(asked[id]) >= ASK_AGAIN_DAYS * 86_400_000;
  const ids = [...suspects].filter(due).slice(0, max);
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`, { headers: TCGCSV_HEADERS, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) continue;
        const holoOnly = tcgdexHoloOnly(((await res.json()) as { variants?: unknown }).variants);
        if (holoOnly == null) continue;
        asked[id] = day;
        if (holoOnly) phantom[id] = phantom[id] ?? day;
        else delete phantom[id];
      } catch {
        // asked again on the next run
      }
    }
  };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  if (ids.length) {
    await setSetting(PHANTOM_NORMAL_KEY, JSON.stringify(phantom));
    await setSetting(PRINTINGS_ASKED_KEY, JSON.stringify(asked));
    memo = null;
  }
  return new Set([...suspects].filter((id) => phantom[id]));
}

const MEMO_MS = 10 * 60 * 1000;
let memo: { at: number; ids: Set<string> } | null = null;

/** Every card TCGdex confirmed holo only (memoized 10 min). Fails open: none. */
export async function phantomNormalCards(): Promise<Set<string>> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.ids;
  try {
    const ids = new Set(Object.keys(JSON.parse((await getSetting(PHANTOM_NORMAL_KEY)) ?? "{}") as Record<string, string>));
    memo = { at: Date.now(), ids };
    return ids;
  } catch {
    return new Set();
  }
}

/** Pure: a phantom card's prices without its TCGplayer "normal" row, while a priced TCGplayer holofoil row stays. */
export function withoutPhantomNormalRow(prices: CardPrice[]): CardPrice[] {
  const holo = prices.some((p) => p.source === "tcgplayer" && p.variant === "holofoil" && p.market != null && p.market > 0);
  return holo ? prices.filter((p) => !(p.source === "tcgplayer" && p.variant === "normal")) : prices;
}

/**
 * Live prices without the phantom "normal" rows: pokemontcg.io republishes TCGplayer's Normal printing for these cards,
 * so a scan (and the price-history points it records) would bring the line back the nightly run deleted. Fails open.
 */
export async function withoutPhantomNormals<T extends { id: string; game?: string; prices: CardPrice[] }>(cards: T[]): Promise<T[]> {
  if (!cards.some((c) => (c.game ?? "pokemon") === "pokemon" && c.prices.some((p) => p.variant === "normal"))) return cards;
  const phantom = await phantomNormalCards();
  if (phantom.size === 0) return cards;
  return cards.map((c) => ((c.game ?? "pokemon") === "pokemon" && phantom.has(c.id) ? { ...c, prices: withoutPhantomNormalRow(c.prices) } : c));
}
