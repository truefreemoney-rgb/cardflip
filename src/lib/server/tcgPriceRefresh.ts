import { TCGCSV_HEADERS, TCGCSV_PAUSE_MS, tcgcsvFetch } from "@/lib/server/tcgcsv";
import { yugiohBackupFromYgoprodeck } from "@/lib/server/priceBackups";
import { db } from "@/lib/db";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
import { readSeriesMap, upsertSeriesRows, type SeriesUpsert } from "@/lib/server/priceBulkWrite";
import type { TcgGame } from "@/lib/server/tcgCards";
import { onePieceDonKey, parseOnePieceDon } from "@/lib/onepiece";
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
  const map = CARDMARKET_MAPS[game];
  if (!map || !Object.keys(map).length) return base;
  try {
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
 *   One Piece — optcgapi, three bulk calls (card_image_id = row id)
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
        const prices = listOf<{ productId: number; subTypeName?: string; marketPrice?: unknown; midPrice?: unknown }>(
          await getJson(`${API}/${g.groupId}/prices`),
        );
        const byProduct = new Map<number, Record<string, number | null>>();
        for (const p of prices) {
          const entry = byProduct.get(p.productId) ?? {};
          entry[p.subTypeName ?? ""] = num(p.marketPrice) ?? num(p.midPrice);
          byProduct.set(p.productId, entry);
        }
        // Same split as scripts/sync-yugioh.mjs: the unstamped row takes
        // Unlimited (or Limited, or any other subtype), the -1st twin 1st Edition.
        for (const [pid, priced] of byProduct) {
          const first = priced["1st Edition"] ?? null;
          const unl = priced["Unlimited"] ?? priced["Limited"] ?? null;
          const other = Object.entries(priced).find(([k]) => !/^(1st Edition|Unlimited|Limited)$/.test(k))?.[1] ?? null;
          if (unl != null || other != null) points.push({ id: `ygo-${pid}`, usd: unl ?? other, foil: null });
          if (first != null) points.push({ id: `ygo-${pid}-1st`, usd: first, foil: null });
        }
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
  if (game === "onepiece") {
    for (const p of points) {
      const k = `${p.id}|${p.setName ?? ""}`;
      byPrinting.set(k, [...(byPrinting.get(k) ?? []), p]);
    }
  }
  const columns: TcgPoint[] = [];
  const upserts: SeriesUpsert[] = [];
  for (const [id, held] of mirror) {
    let p: TcgPoint | undefined;
    if (game === "onepiece") {
      const same = byPrinting.get(`${id.split("#")[0]}|${held.setName ?? ""}`) ?? [];
      p = same.find((c) => (c.variant ?? "") === (held.variant ?? "")) ?? same[0];
    } else {
      p = byId.get(id);
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
  const first = game === "lorcana" ? await lorcanaPointsWithFill() : game === "onepiece" ? await onePiecePoints() : await yugiohPoints();
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
