import { TCGCSV_HEADERS, TCGCSV_PAUSE_MS, tcgcsvFetch } from "@/lib/server/tcgcsv";
import { askingPrice } from "@/lib/server/mtgTcgplayerFill";
import { yugiohBackupFromYgoprodeck } from "@/lib/server/priceBackups";
import { db } from "@/lib/db";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
import { readSeriesMap, upsertSeriesRows, type SeriesUpsert } from "@/lib/server/priceBulkWrite";
import type { TcgGame } from "@/lib/server/tcgCards";
import { onePieceDonKey, onePieceProductPrice, parseOnePieceDon } from "@/lib/onepiece";
import { CARDMARKET_GAME, CONVERTED_SOURCE, fetchPriceGuide, guideUsd } from "@/lib/server/cardmarket";
import { CARDTRADER_SOURCE, cardtraderLorcanaPrices, cardtraderYugiohPrices, type CtLorcanaRow } from "@/lib/server/cardtrader";
import cardmarketYugioh from "@/data/cardmarket-yugioh.json" with { type: "json" };
import cardmarketLorcana from "@/data/cardmarket-lorcana.json" with { type: "json" };

/** Our card id → Cardmarket idProduct (scripts/build-cardmarket-map.mjs), for cards TCGplayer leaves unpriced. */
const CARDMARKET_MAPS: Partial<Record<TcgGame, Record<string, number>>> = { yugioh: cardmarketYugioh, lorcana: cardmarketLorcana };

/**
 * Pure: the map's cards still without a dollar price today → Cardmarket's
 * figure converted (lib/server/cardmarket.ts guards apply). Exported for
 * scripts/test-tcg-prices.mjs.
 */
export function cardmarketPoints(
  points: TcgPoint[],
  map: Record<string, number>,
  guide: Map<number, Parameters<typeof guideUsd>[0]>,
  usdPerEur: number | null,
): TcgPoint[] {
  const priced = new Set(points.filter((p) => p.usd != null || p.foil != null).map((p) => p.id));
  const out: TcgPoint[] = [];
  for (const [id, product] of Object.entries(map)) {
    if (priced.has(id)) continue;
    const { usd, foil } = guideUsd(guide.get(product), usdPerEur);
    if (usd != null || foil != null) out.push({ id, usd, foil, source: CONVERTED_SOURCE });
  }
  return out;
}

/**
 * Yu-Gi-Oh! and Lorcana (plain + foil): CardTrader's cheapest Near Mint listing for cards TCGplayer gave
 * no price today (lib/server/cardtrader.ts). The gap rows are the mirror's
 * unpriced ones plus the ones CardTrader priced before, so those keep moving.
 * Skipped without CARDTRADER_TOKEN. Never throws.
 */
async function withCardtrader(game: TcgGame, day: string, base: { points: TcgPoint[]; failed: number }): Promise<{ points: TcgPoint[]; failed: number }> {
  const token = process.env.CARDTRADER_TOKEN?.trim();
  if ((game !== "yugioh" && game !== "lorcana") || !token) return base;
  try {
    const priced = new Set(base.points.filter((p) => p.usd != null || p.foil != null).map((p) => p.id));
    const before = new Set([...(await readSeriesMap(game, CARDTRADER_SOURCE)).keys()].map((k) => k.split("|")[0]));
    if (game === "lorcana") {
      const rows = ((await db
        .prepare("SELECT id, name, subtitle, set_code AS setCode, collector_number AS number, price_usd, price_usd_foil FROM tcg_cards WHERE game = 'lorcana' AND set_release_date <= ?")
        .all(day)) as (CtLorcanaRow & { price_usd: number | null; price_usd_foil: number | null })[])
        .filter((r) => !priced.has(r.id) && ((r.price_usd == null && r.price_usd_foil == null) || before.has(r.id)));
      if (!rows.length) return base;
      const rate = await (await import("@/lib/server/fx")).usdPerEur().catch(() => null);
      const fill = (await cardtraderLorcanaPrices(rows, token, rate)).map((p): TcgPoint => ({ id: p.id, usd: p.usd, foil: p.foil, source: CARDTRADER_SOURCE }));
      return { ...base, points: [...base.points, ...fill] };
    }
    const rows = ((await db
      .prepare("SELECT id, name, collector_number AS number, rarity, price_usd, price_usd_foil FROM tcg_cards WHERE game = 'yugioh'")
      .all()) as { id: string; name: string; number: string; rarity: string | null; price_usd: number | null; price_usd_foil: number | null }[])
      .filter((r) => !priced.has(r.id) && ((r.price_usd == null && r.price_usd_foil == null) || before.has(r.id)));
    if (!rows.length) return base;
    const rate = await (await import("@/lib/server/fx")).usdPerEur().catch(() => null);
    const fill = (await cardtraderYugiohPrices(rows, token, rate)).map((p): TcgPoint => ({ id: p.id, usd: p.usd, foil: null, source: CARDTRADER_SOURCE }));
    return { ...base, points: [...base.points, ...fill] };
  } catch (err) {
    console.warn("yugioh cardtrader fill:", err instanceof Error ? err.message : err);
    return base;
  }
}

/** TCGplayer's points plus Cardmarket's (converted) for the mapped cards TCGplayer can't price. Never throws. */
async function withCardmarket(game: TcgGame, base: { points: TcgPoint[]; failed: number }): Promise<{ points: TcgPoint[]; failed: number }> {
  if (!CARDMARKET_MAPS[game]) return base;
  try {
    // The nightly map in the database (cardmarket_map) on top of the bundled one, so new cards need no deploy.
    const map: Record<string, number> = { ...CARDMARKET_MAPS[game] };
    const rows = (await db.prepare("SELECT card_id, product_id FROM cardmarket_map WHERE game = ?").all(game)) as { card_id: string; product_id: number }[];
    for (const r of rows) map[r.card_id] = Number(r.product_id);
    if (!Object.keys(map).length) return base;
    const rate = await (await import("@/lib/server/fx")).usdPerEur();
    const fill = cardmarketPoints(base.points, map, await fetchPriceGuide(CARDMARKET_GAME[game as "yugioh" | "lorcana"]), rate);
    const have = new Set(fill.map((p) => p.id));
    return { ...base, points: [...base.points.filter((p) => !have.has(p.id)), ...fill] };
  } catch (err) {
    console.warn(`${game} cardmarket fill:`, err instanceof Error ? err.message : err);
    return base;
  }
}

/**
 * Daily Lorcana / One Piece / Yu-Gi-Oh! prices (09-30, Chris: "we need the
 * history price data like pokemon has"). Until now these games only had the
 * weekly catalog sync on Chris's PC, which overwrote one current price and
 * kept no history — charts, alerts and inventory value had nothing to read.
 * Every run refreshes tcg_cards' price columns and appends today's point to
 * price_series (variant "normal" = price_usd, "foil" = price_usd_foil — the
 * labels toCard gives them), same compact rows and 5¢ rule as Pokémon/Magic.
 *
 * Sources are the ones the syncs use, so ids line up without a map:
 *   Lorcana  — Lorcast, one call per set (card id = row id)
 *   One Piece — optcgapi, three bulk calls (card_image_id = row id); a row tied to its
 *               TCGplayer product (tcg_product_id, 10-25) takes tcgcsv's price for it instead
 *   Yu-Gi-Oh! — tcgcsv category 2, one /prices call per group
 *               (ygo-<productId>, "-1st" = the 1st Edition subtype)
 * No back-history exists to load: TCGplayer publishes none and tcgcsv's
 * archive is offline ("temporarily removed", 09-30) — history starts today.
 */

const HEADERS = TCGCSV_HEADERS;
const MIN_TRACKED_USD = 0.05;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown): number | null => {
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function getJson<T>(url: string, attempt = 1): Promise<T> {
  // tcgcsv goes through the one-at-a-time gate (its own retry rule, never 4 tries); the other feeds keep theirs.
  const res = url.includes("tcgcsv.com") ? await tcgcsvFetch(url) : await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!url.includes("tcgcsv.com") && (res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(1500 * attempt);
    return getJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

const listOf = <T>(data: unknown): T[] =>
  Array.isArray(data) ? (data as T[]) : ((data as { results?: T[]; data?: T[] })?.results ?? (data as { data?: T[] })?.data ?? []);

export interface TcgPoint {
  id: string;
  usd: number | null;
  foil: number | null;
  /** Where the dollars came from when not TCGplayer (10-05: "cardmarket-converted" = Cardmarket EUR x the day's rate). */
  source?: string;
  /** One Piece: the feed's set name + printing tag — an image id alone repeats across reprint sets. */
  setName?: string;
  variant?: string;
  /** Today's source says the held price is wrong (asking-only over $20): blank it instead of keeping the last one. */
  clear?: boolean;
  /** One Piece: keyed by the mirror row's own id (a TCGplayer promo match), not the feed's image id. */
  row?: boolean;
}

interface MirrorRow {
  usd: number | null;
  foil: number | null;
  setName: string;
  variant: string;
}

/**
 * One Piece printing tag from the feed name, the same mapping as
 * scripts/sync-onepiece.mjs splitVariant ("Perona (Parallel)" → "parallel").
 * Keep the two in step.
 */
export function onePieceNameVariant(name: string): string {
  let rest = (name ?? "").trim();
  let variant = "";
  for (;;) {
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(rest);
    if (!m) break;
    rest = m[1].trim();
    const tag = m[2].toLowerCase().trim();
    if (/^\d+$/.test(tag)) continue;
    const v = /parallel/.test(tag) ? "parallel"
      : /box topper/.test(tag) ? "box-topper"
      : /alt/.test(tag) ? "alt-art"
      : /manga/.test(tag) ? "manga"
      : /reprint/.test(tag) ? "reprint"
      : /sp\b|special/.test(tag) ? "special"
      : tag.replace(/[^a-z0-9]+/g, "-");
    if (!variant) variant = v;
  }
  return variant;
}

async function lorcanaPoints(): Promise<{ points: TcgPoint[]; failed: number }> {
  const API = "https://api.lorcast.com/v0";
  const sets = listOf<{ code: string }>(await getJson(`${API}/sets`));
  const points: TcgPoint[] = [];
  let failed = 0;
  for (const set of sets) {
    try {
      const cards = listOf<{ id: string; lang?: string; prices?: { usd?: unknown; usd_foil?: unknown } }>(
        await getJson(`${API}/sets/${encodeURIComponent(set.code)}/cards`),
      );
      for (const c of cards) {
        if (c.lang && c.lang !== "en") continue;
        points.push({ id: c.id, usd: num(c.prices?.usd), foil: num(c.prices?.usd_foil) });
      }
    } catch (err) {
      failed++;
      console.warn(`lorcana prices ${set.code}:`, err instanceof Error ? err.message : err);
    }
    await sleep(150);
  }
  return { points, failed };
}

const foldLorcana = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/["“”]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export interface LorcanaProduct {
  name: string;
  number: string;
  /** TCGplayer subtype → market price ("Normal", "Foil", "Cold Foil"). */
  prices: Record<string, number>;
}

/**
 * Pure: Lorcana cards Lorcast leaves unpriced (promos: D23, Curator's
 * Collection, Promo Sets, PD1 — 163 cards on 10-05) → TCGplayer's price, when
 * exactly one TCGplayer product has the same "Name - Subtitle" AND the same
 * collector number. Promos reuse names with different art, so a name alone
 * never decides. Exported for scripts/test-tcg-prices.mjs.
 */
export function matchLorcanaProducts(
  cards: { id: string; name: string; subtitle: string | null; number: string }[],
  products: LorcanaProduct[],
): TcgPoint[] {
  const bare = (n: string) => n.trim().toLowerCase().replace(/^0+(?=\w)/, "");
  const byKey = new Map<string, LorcanaProduct[]>();
  for (const p of products) {
    const k = `${foldLorcana(p.name)}#${bare(p.number)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const out: TcgPoint[] = [];
  for (const c of cards) {
    const hits = byKey.get(`${foldLorcana(`${c.name} ${c.subtitle ?? ""}`)}#${bare(c.number)}`) ?? [];
    if (hits.length !== 1) continue;
    const pr = hits[0].prices;
    const usd = num(pr["Normal"]);
    const foil = num(pr["Foil"] ?? pr["Cold Foil"] ?? pr["Holofoil"]);
    if (usd != null || foil != null) out.push({ id: c.id, usd, foil });
  }
  return out;
}

/** TCGplayer's Lorcana catalogue (tcgcsv category 71), every group's priced products. */
async function lorcanaTcgplayerProducts(): Promise<LorcanaProduct[]> {
  const API = "https://tcgcsv.com/tcgplayer/71";
  const groups = listOf<{ groupId: number }>(await getJson(`${API}/groups`));
  const out: LorcanaProduct[] = [];
  const queue = [...groups];
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        const products = listOf<{ productId: number; name?: string; extendedData?: { name: string; value: string }[] }>(await getJson(`${API}/${g.groupId}/products`));
        const prices = listOf<{ productId: number; subTypeName?: string; marketPrice?: unknown }>(await getJson(`${API}/${g.groupId}/prices`));
        const byProduct = new Map<number, Record<string, number>>();
        for (const p of prices) {
          const v = num(p.marketPrice);
          if (v == null) continue;
          byProduct.set(p.productId, { ...(byProduct.get(p.productId) ?? {}), [p.subTypeName ?? "Normal"]: v });
        }
        for (const p of products) {
          const priced = byProduct.get(p.productId);
          const number = (p.extendedData?.find((e) => e.name === "Number")?.value ?? "").split("/")[0];
          if (priced && p.name && number) out.push({ name: p.name, number, prices: priced });
        }
      } catch (err) {
        console.warn(`lorcana tcgplayer group ${g.groupId}:`, err instanceof Error ? err.message : err);
      }
      await sleep(TCGCSV_PAUSE_MS);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  return out;
}

/** Lorcast's points plus TCGplayer's for the cards Lorcast prices at nothing (10-05). */
async function lorcanaPointsWithFill(): Promise<{ points: TcgPoint[]; failed: number }> {
  const base = await lorcanaPoints();
  try {
    const priced = new Set(base.points.filter((p) => p.usd != null || p.foil != null).map((p) => p.id));
    const rows = (await db
      .prepare("SELECT id, name, subtitle, collector_number AS number FROM tcg_cards WHERE game = 'lorcana'")
      .all()) as { id: string; name: string; subtitle: string | null; number: string }[];
    const gaps = rows.filter((r) => !priced.has(r.id));
    if (gaps.length) {
      const fill = matchLorcanaProducts(gaps, await lorcanaTcgplayerProducts());
      const have = new Set(fill.map((p) => p.id));
      base.points = [...base.points.filter((p) => !have.has(p.id)), ...fill];
    }
  } catch (err) {
    console.warn("lorcana tcgplayer fill:", err instanceof Error ? err.message : err);
  }
  return base;
}

/**
 * Pure: One Piece promo rows → TCGplayer's market, when exactly one product in TCGplayer's Promotion Cards
 * group has the same name (the sync keeps TCGplayer's "(Online Regional 2024 Vol. 2) [Finalist]" tags) AND
 * the same card number, priced in one subtype only. optcgapi's figure for those ran stale and low (10-24:
 * 23 of 96 matched promos >25% under, Kid P-003 Online Finalist $19.63 vs $153.75) and TCGplayer is the
 * first source. Keyed by the mirror row id (`row`). Exported for scripts/test-tcg-prices.mjs.
 */
export function matchOnePiecePromos(cards: { id: string; name: string; number: string }[], products: LorcanaProduct[]): TcgPoint[] {
  const fold = (n: string) => n.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
  const byKey = new Map<string, LorcanaProduct[]>();
  for (const p of products) {
    const k = `${fold(p.name)}#${p.number.trim().toUpperCase()}`;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const out: TcgPoint[] = [];
  for (const c of cards) {
    const hits = byKey.get(`${fold(c.name)}#${c.number.trim().toUpperCase()}`) ?? [];
    if (hits.length !== 1) continue;
    // Two priced subtypes are two printings: never guess which one the row is.
    const priced = Object.values(hits[0].prices).map(num).filter((v): v is number => v != null);
    if (priced.length === 1) out.push({ id: c.id, usd: priced[0], foil: null, row: true });
  }
  return out;
}

/** TCGplayer's One Piece Promotion Cards group (tcgcsv category 68), its priced products. */
async function onePiecePromoProducts(): Promise<LorcanaProduct[]> {
  const API = "https://tcgcsv.com/tcgplayer/68";
  const group = listOf<{ groupId: number; name?: string }>(await getJson(`${API}/groups`)).find((g) => g.name === "One Piece Promotion Cards");
  if (!group) throw new Error("no One Piece Promotion Cards group on tcgcsv");
  const products = listOf<{ productId: number; name?: string; extendedData?: { name: string; value: string }[] }>(await getJson(`${API}/${group.groupId}/products`));
  const prices = listOf<{ productId: number; subTypeName?: string; marketPrice?: unknown }>(await getJson(`${API}/${group.groupId}/prices`));
  const byProduct = new Map<number, Record<string, number>>();
  for (const p of prices) {
    const v = num(p.marketPrice);
    if (v == null) continue;
    byProduct.set(p.productId, { ...(byProduct.get(p.productId) ?? {}), [p.subTypeName ?? "Normal"]: v });
  }
  const out: LorcanaProduct[] = [];
  for (const p of products) {
    const priced = byProduct.get(p.productId);
    const number = p.extendedData?.find((e) => e.name === "Number")?.value ?? "";
    if (priced && p.name && number) out.push({ name: p.name, number, prices: priced });
  }
  return out;
}

type OnePiecePriceRow = { productId: number; subTypeName?: string; marketPrice?: unknown; midPrice?: unknown };

/**
 * Pure: One Piece rows tied to their TCGplayer product (tcg_cards.tcg_product_id, set by the nightly
 * scripts/sync-onepiece-tcg.mjs, 10-25) → one point per row, priced from its own product by the nightly's own
 * rule (lib/onepiece.ts onePieceProductPrice), keyed by the row (`row`). A tied row TCGplayer prices nothing for
 * today still gets a point, an empty one: it keeps its last price instead of taking optcgapi's figure for its
 * number, which is another printing's (Usopp OP11-003_r1 flipped $1.66 at the 2am push / $0.09 here, nightly).
 * Exported for scripts/test-tcg-prices.mjs.
 */
export function onePieceTiedPoints(tied: { id: string; productId: number }[], prices: OnePiecePriceRow[]): TcgPoint[] {
  const byProduct = new Map<number, OnePiecePriceRow[]>();
  for (const p of prices) byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);
  return tied.map((t) => {
    const rows = byProduct.get(t.productId);
    return { id: t.id, usd: rows ? onePieceProductPrice(rows) : null, foil: null, row: true };
  });
}

/** Every tcgcsv One Piece group's prices, for the rows tied to a product. Nothing when no row is tied (or the column is not there yet). */
async function onePieceProductPoints(): Promise<TcgPoint[]> {
  let tied: { id: string; productId: number }[];
  try {
    tied = (await db
      .prepare("SELECT id, tcg_product_id AS productId FROM tcg_cards WHERE game = 'onepiece' AND tcg_product_id IS NOT NULL")
      .all()) as { id: string; productId: number }[];
  } catch {
    return []; // tcg_product_id not on this database yet (lib/db.ts probe, push-catalog adds it)
  }
  if (tied.length === 0) return [];
  const API = "https://tcgcsv.com/tcgplayer/68";
  const groups = listOf<{ groupId: number }>(await getJson(`${API}/groups`));
  const prices: OnePiecePriceRow[] = [];
  let failed = 0;
  const queue = [...groups];
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        prices.push(...listOf<OnePiecePriceRow>(await getJson(`${API}/${g.groupId}/prices`)));
      } catch (err) {
        failed++;
        console.warn(`onepiece prices group ${g.groupId}:`, err instanceof Error ? err.message : err);
      }
      await sleep(TCGCSV_PAUSE_MS);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  if (failed) console.warn(`onepiece prices: ${failed} tcgcsv group(s) failed, their tied rows keep yesterday's price`);
  return onePieceTiedPoints(tied, prices);
}

/** optcgapi's points, plus TCGplayer's market on the promos that match one product exactly (10-24) and on every tied row (10-25). */
async function onePiecePointsWithPromos(): Promise<{ points: TcgPoint[]; failed: number }> {
  const base = await onePiecePoints();
  try {
    const rows = (await db
      .prepare("SELECT id, name, collector_number AS number FROM tcg_cards WHERE game = 'onepiece' AND set_code = 'PROMO'")
      .all()) as { id: string; name: string; number: string }[];
    base.points.push(...matchOnePiecePromos(rows, await onePiecePromoProducts()));
  } catch (err) {
    console.warn("onepiece tcgplayer promos:", err instanceof Error ? err.message : err);
  }
  // After the promo matches: a row's own product beats its name match (planTcgRefresh keeps the last row point).
  try {
    base.points.push(...(await onePieceProductPoints()));
  } catch (err) {
    console.warn("onepiece tcgplayer products:", err instanceof Error ? err.message : err);
  }
  return base;
}

async function onePiecePoints(): Promise<{ points: TcgPoint[]; failed: number }> {
  const API = "https://optcgapi.com/api";
  const points: TcgPoint[] = [];
  let failed = 0;
  // "allPromoCards" became "allPromos" (404 on 09-30).
  for (const path of ["allSetCards", "allSTCards", "allPromos"]) {
    try {
      const rows = listOf<{ card_set_id?: string; card_image_id?: string; card_name?: string; set_name?: string; market_price?: unknown }>(
        await getJson(`${API}/${path}/`),
      );
      for (const c of rows) {
        const key = String(c.card_set_id ?? "").trim();
        if (!key) continue;
        points.push({
          id: String(c.card_image_id ?? key),
          usd: num(c.market_price),
          foil: null,
          setName: String(c.set_name ?? ""),
          variant: onePieceNameVariant(String(c.card_name ?? "")),
        });
      }
    } catch (err) {
      failed++;
      console.warn(`onepiece prices ${path}:`, err instanceof Error ? err.message : err);
    }
  }
  // DON!! cards (10-01): their own feed, no card id; the mirror row's id is
  // the feed's full name folded (lib/onepiece onePieceDonKey), one row each.
  try {
    const rows = listOf<{ card_name?: string; optcg_don_name?: string; market_price?: unknown }>(await getJson(`${API}/allDonCards/`));
    for (const c of rows) {
      if (!c.optcg_don_name) continue;
      const don = parseOnePieceDon(String(c.card_name ?? ""), c.optcg_don_name);
      points.push({ id: onePieceDonKey(c.optcg_don_name), usd: num(c.market_price), foil: null, setName: don.setName, variant: don.variant });
    }
  } catch (err) {
    failed++;
    console.warn("onepiece prices allDonCards:", err instanceof Error ? err.message : err);
  }
  return { points, failed };
}

type YgoPriceRow = { productId: number; subTypeName?: string; marketPrice?: unknown; midPrice?: unknown };

/**
 * Pure: one tcgcsv Yu-Gi-Oh! group's price rows → points. Same split as scripts/sync-yugioh.mjs: the unstamped
 * row takes Unlimited (or Limited, or any other subtype), the -1st twin 1st Edition. Exported for the test.
 */
export function yugiohGroupPoints(prices: YgoPriceRow[]): TcgPoint[] {
  const byProduct = new Map<number, Record<string, number | null>>();
  const sold = new Map<number, Set<string>>();
  // Subtypes with only an asking price over ASKING_MAX_USD (10-13: 399 such Yu-Gi-Oh prices, Acrobat Monkey
  // $20.16 against a 44c cheapest listing, a $5,000 Duel Terminal preview): blank, not the old price.
  const asked = new Map<number, Set<string>>();
  for (const p of prices) {
    const entry = byProduct.get(p.productId) ?? {};
    const sub = p.subTypeName ?? "";
    const market = num(p.marketPrice);
    entry[sub] = market ?? askingPrice(p.midPrice);
    if (market != null) sold.set(p.productId, (sold.get(p.productId) ?? new Set()).add(sub));
    if (entry[sub] == null && num(p.midPrice) != null) asked.set(p.productId, (asked.get(p.productId) ?? new Set()).add(sub));
    byProduct.set(p.productId, entry);
  }
  const points: TcgPoint[] = [];
  for (const [pid, priced] of byProduct) {
    const first = priced["1st Edition"] ?? null;
    const unlKey = priced["Unlimited"] != null ? "Unlimited" : "Limited";
    const unl = priced[unlKey] ?? null;
    const [otherKey, other] = Object.entries(priced).find(([k]) => !/^(1st Edition|Unlimited|Limited)$/.test(k)) ?? ["", null];
    const s = sold.get(pid);
    // An unstamped printing nobody has bought yet takes its own 1st Edition sales before any asking price
    // (10-23 C10: 149 such rows froze on pre-10-13 asking prices, Penguin Soldier BP01 $450.85 against $0.55 sold).
    const base =
      (s?.has(unlKey) ? unl : null) ?? (s?.has(otherKey) ? other : null) ?? (s?.has("1st Edition") ? first : null) ?? unl ?? other;
    const a = asked.get(pid);
    // A 1st-only printing has no unstamped row in the catalog; planTcgRefresh walks catalog ids, so its point is dropped.
    if (base != null) points.push({ id: `ygo-${pid}`, usd: base, foil: null });
    else if (a && [...a].some((k) => k !== "1st Edition")) points.push({ id: `ygo-${pid}`, usd: null, foil: null, clear: true });
    if (first != null) points.push({ id: `ygo-${pid}-1st`, usd: first, foil: null });
    else if (a?.has("1st Edition")) points.push({ id: `ygo-${pid}-1st`, usd: null, foil: null, clear: true });
  }
  return points;
}

async function yugiohPoints(): Promise<{ points: TcgPoint[]; failed: number; backup?: string }> {
  const API = "https://tcgcsv.com/tcgplayer/2";
  let groups: { groupId: number }[];
  try {
    groups = listOf<{ groupId: number }>(await getJson(`${API}/groups`));
  } catch (err) {
    // tcgcsv down (10-08, our agent blocked): YGOPRODeck carries the same TCGplayer price per printing.
    console.warn("yugioh tcgcsv groups:", err instanceof Error ? err.message : err);
    const b = await yugiohBackupFromYgoprodeck();
    return { points: b.points, failed: 1, backup: "ygoprodeck" };
  }
  const points: TcgPoint[] = [];
  let failed = 0;
  const queue = [...groups];
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        points.push(...yugiohGroupPoints(listOf<YgoPriceRow>(await getJson(`${API}/${g.groupId}/prices`))));
      } catch (err) {
        failed++;
        console.warn(`yugioh prices group ${g.groupId}:`, err instanceof Error ? err.message : err);
      }
      await sleep(TCGCSV_PAUSE_MS);
    }
  };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  if (points.length === 0 && groups.length > 0) {
    const b = await yugiohBackupFromYgoprodeck();
    return { points: b.points, failed, backup: "ygoprodeck" };
  }
  return { points, failed };
}

/** Every id the mirror carries for a game (rowid-paginated, Yu-Gi-Oh! is 60k). */
async function mirrorIds(game: TcgGame): Promise<Map<string, MirrorRow>> {
  const out = new Map<string, MirrorRow>();
  const PAGE = 30_000;
  let after = -1;
  for (;;) {
    const rows = (await db
      .prepare(`SELECT rowid AS rid, id, price_usd, price_usd_foil, set_name, variant FROM tcg_cards WHERE game = ? AND rowid > ? ORDER BY rowid LIMIT ${PAGE}`)
      .all(game, after)) as { rid: number; id: string; price_usd: number | null; price_usd_foil: number | null; set_name: string; variant: string }[];
    for (const r of rows) out.set(r.id, { usd: r.price_usd, foil: r.price_usd_foil, setName: r.set_name ?? "", variant: r.variant ?? "" });
    if (rows.length < PAGE) return out;
    after = Number(rows[rows.length - 1].rid);
  }
}

/** Batch price-column update, only rows whose price moved (Turso bills writes). */
async function updatePriceColumns(rows: TcgPoint[]): Promise<void> {
  const PER_STMT = 400;
  for (let i = 0; i < rows.length; i += PER_STMT) {
    const slice = rows.slice(i, i + PER_STMT);
    const values = slice.map(() => "(?, ?, ?)").join(", ");
    const args: (string | number | null)[] = [];
    for (const r of slice) args.push(r.id, r.usd, r.foil);
    await db
      .prepare(
        `UPDATE tcg_cards SET price_usd = v.column2, price_usd_foil = v.column3
         FROM (VALUES ${values}) AS v WHERE tcg_cards.id = v.column1`,
      )
      .run(...args);
  }
}

export interface TcgRefreshResult {
  fetched: number;
  sourcesFailed: number;
  pricesChanged: number;
  seriesTouched: number;
  day: string;
  /** The first source answered nothing; the day's points came from this one instead (lib/server/priceBackups.ts). */
  backup?: string;
}

/**
 * Pure: today's points against what the mirror holds → the column updates and
 * series upserts. Exported for scripts/test-tcg-prices.mjs.
 */
export function planTcgRefresh(
  game: TcgGame,
  points: TcgPoint[],
  mirror: Map<string, { usd: number | null; foil: number | null; setName?: string; variant?: string }>,
  existingSeries: Map<string, { startDay: string; prices: string }>,
  day: string,
  /** Series of the non-TCGplayer sources, keyed "source|id|variant". */
  otherSeries: Map<string, { startDay: string; prices: string }> = new Map(),
): { columns: TcgPoint[]; upserts: SeriesUpsert[] } {
  const byId = new Map(points.map((p) => [p.id, p]));
  // One Piece: an image id repeats across reprint sets (OP09-077 is also the
  // Premium Card Collection promo, $32 vs a few cents) and the sync stores
  // the repeat as "<id>#n". Match on image id + set name, then printing tag.
  const byPrinting = new Map<string, TcgPoint[]>();
  const byRow = new Map<string, TcgPoint>();
  if (game === "onepiece") {
    for (const p of points) {
      if (p.row) {
        byRow.set(p.id, p);
        continue;
      }
      const k = `${p.id}|${p.setName ?? ""}`;
      byPrinting.set(k, [...(byPrinting.get(k) ?? []), p]);
    }
  }
  const columns: TcgPoint[] = [];
  const upserts: SeriesUpsert[] = [];
  for (const [id, held] of mirror) {
    let p: TcgPoint | undefined;
    if (game === "onepiece") {
      // TCGplayer's own match for this exact row comes first (promos, 10-24; every row tied to its product, 10-25).
      p = byRow.get(id);
      // A tied row, or one the nightly added for a TCGplayer printing ("OP17-006#tcg712668"), never borrows the
      // feed's price for its number: that is another printing's (the "#" split would hand a release event copy the
      // base card's). With no price of its own today it keeps the last one.
      if (!p && !id.includes("#tcg")) {
        const same = byPrinting.get(`${id.split("#")[0]}|${held.setName ?? ""}`) ?? [];
        p = same.find((c) => (c.variant ?? "") === (held.variant ?? "")) ?? same[0];
        // A starter-deck reprint ("OP12-113_r1", variant "reprint") is the same card as its original printing:
        // TCGplayer sells them as one product and optcgapi prices only the original (10-13: 29 ST31-36 rows sat at $0).
        if ((!p || (p.usd == null && p.foil == null)) && held.variant === "reprint") {
          const original = id.split("#")[0].replace(/[_-]r\d+$/, ""); // "_r1", once "-r1" (OP13-008-r1)
          p = points.find((c) => c.id === original && !c.variant && (c.usd != null || c.foil != null)) ?? p;
        }
      }
    } else {
      p = byId.get(id);
    }
    if (p?.clear) {
      if (held.usd != null || held.foil != null) columns.push({ id, usd: null, foil: null });
      continue;
    }
    // No price today (source hiccup, delisted) → keep the last known price and series.
    if (!p || (p.usd == null && p.foil == null)) continue;
    if (p.usd !== held.usd || p.foil !== held.foil) columns.push({ id, usd: p.usd, foil: p.foil });
    for (const [variant, price] of [["normal", p.usd], ["foil", p.foil]] as const) {
      if (price == null) continue;
      const source = p.source ?? "tcgplayer";
      const existing = source === "tcgplayer" ? existingSeries.get(`${id}|${variant}`) : otherSeries.get(`${source}|${id}|${variant}`);
      if (!existing && price < MIN_TRACKED_USD) continue;
      const next = setDay(existing ? { startDay: existing.startDay, prices: decodePrices(existing.prices) } : null, day, price);
      upserts.push({ cardId: id, game, variant, source, currency: "USD", startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day });
    }
  }
  return { columns, upserts };
}

export async function refreshTcgPrices(game: TcgGame, day = todayUtc()): Promise<TcgRefreshResult> {
  // Order: TCGplayer, then CardTrader (Yu-Gi-Oh), then Cardmarket for whatever is still unpriced.
  const first = game === "lorcana" ? await lorcanaPointsWithFill() : game === "onepiece" ? await onePiecePointsWithPromos() : await yugiohPoints();
  const backup = (first as { backup?: string }).backup;
  const { points, failed } = await withCardmarket(game, await withCardtrader(game, day, first));
  // A source that answered nothing at all must not look like "no prices".
  if (points.length === 0) throw new Error(`${game}: no prices fetched (${failed} source calls failed)`);
  const mirror = await mirrorIds(game);
  const existingSeries = await readSeriesMap(game, "tcgplayer");
  const otherSeries = new Map<string, { startDay: string; prices: string }>();
  for (const source of new Set(points.map((p) => p.source).filter((s): s is string => !!s))) {
    for (const [k, v] of await readSeriesMap(game, source)) otherSeries.set(`${source}|${k}`, v);
  }
  const { columns, upserts } = planTcgRefresh(game, points, mirror, existingSeries, day, otherSeries);
  await updatePriceColumns(columns);
  await upsertSeriesRows(upserts);
  return { fetched: points.length, sourcesFailed: failed, pricesChanged: columns.length, seriesTouched: upserts.length, day, ...(backup ? { backup } : {}) };
}
