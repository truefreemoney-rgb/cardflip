import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { streamJsonObjects } from "@/lib/server/jsonStream";
import { allListingLows, guardFills, readMtgGapRows, readOracleMaxUsd, tcgplayerFills, type ListingSpread } from "@/lib/server/mtgTcgplayerFill";
import { CARDTRADER_SOURCE, cardtraderMtgPrices } from "@/lib/server/cardtrader";
import { CONVERTED_SOURCE } from "@/lib/server/cardmarket";
import { cardkingdomFills, fetchCardkingdomList } from "@/lib/server/cardkingdom";
import { CARD_KINGDOM_SOURCE, cardmarketLift } from "@/lib/priceChain";
import { PRICE_TRUST } from "@/lib/server/priceTrust";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
import {
  readMtgCardPrices,
  LOW_TRACKED_USD,
  readSeriesMap,
  updateMtgPriceColumns,
  upsertListingLows,
  upsertSeriesRows,
  type ListingLow,
  type MtgPriceRow,
  type SeriesKeyed,
  type SeriesUpsert,
} from "@/lib/server/priceBulkWrite";

/**
 * Nightly Magic price refresh that works FROM FLY.
 *
 * The paginated Scryfall search that scripts/sync-mtg.mjs uses (~540 calls)
 * gets 429'd on Fly's shared egress IP, but Scryfall also publishes one bulk
 * file per day ("default_cards" — today a ~78 MB gzipped JSONL, one card per
 * line, on a CDN; older index entries offered a plain JSON array, which is
 * still handled). Streaming that file updates every printing's prices in the
 * mirror and appends today's point to each tracked price series — so the
 * charts move daily without a PC in the loop. Identification data (names,
 * sets, images) still comes from the full sync + seed; this only touches
 * prices. No "server-only" marker: scripts/refresh-prices.mjs drives it too.
 */

const BULK_INDEX = "https://api.scryfall.com/bulk-data/default-cards";
const HEADERS = {
  "User-Agent": "CardFlip/1.0 (+https://cardflip-superior.fly.dev)",
  Accept: "application/json",
};
/** Bulk under 5¢ isn't tracked unless a series already exists (seed rule). */
const MIN_TRACKED_USD = 0.05;

interface ScryfallCard {
  id: string;
  lang?: string;
  tcgplayer_id?: number;
  released_at?: string;
  prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null; eur?: string | null; eur_foil?: string | null };
}

const num = (v: string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export interface RefreshResult {
  scanned: number;
  updated: number;
  seriesTouched: number;
  day: string;
  /** Mirror rows whose prices actually changed (only those are written). */
  mirrorChanged?: number;
  /** Series today's run had already written (a resumed run skips them). */
  seriesSkipped?: number;
  /** Rows Scryfall left without a dollar price that took TCGplayer's. */
  tcgplayerFilled?: number;
  /** Rows still blank that took CardTrader's cheapest NM listing (chain step 5, last). */
  cardtraderFilled?: number;
  /** Rows still blank that took Scryfall's Cardmarket euro price, converted and lifted (10-13; step 3). */
  cardmarketFilled?: number;
  /** Rows still blank that took Card Kingdom's retail divided by 1.24 (10-19; step 4). */
  cardkingdomFilled?: number;
  /** Prices over 1.5x the cheapest live listing that took the listing (capToListing). */
  cappedToListing?: number;
}

/**
 * What one run writes, computed in memory (09-30: pure, so the resume rule is
 * tested without Scryfall or Turso). Mirror rows are written only when a
 * price changed (~40% of rows on a normal day). A series already written
 * today is skipped, so a run killed half way (the 09-30 IOERR, the 300s cap)
 * resumes where it stopped instead of starting over.
 */
export function planMtgWrites(
  pending: MtgPriceRow[],
  mirror: Map<string, MtgPriceRow>,
  series: Map<string, SeriesKeyed>,
  day: string,
  ctSeries: Map<string, SeriesKeyed> = new Map(),
  cmSeries: Map<string, SeriesKeyed> = new Map(),
  ckSeries: Map<string, SeriesKeyed> = new Map(),
): { kept: MtgPriceRow[]; mirrorRows: MtgPriceRow[]; upserts: SeriesUpsert[]; seriesSkipped: number } {
  const kept = pending.filter((c) => mirror.has(c.id));
  const same = (a: MtgPriceRow, b: MtgPriceRow) => a.usd === b.usd && a.foil === b.foil && a.etched === b.etched && a.eur === b.eur && a.eurFoil === b.eurFoil;
  const mirrorRows = kept.filter((c) => !same(c, mirror.get(c.id)!));
  const upserts: SeriesUpsert[] = [];
  let seriesSkipped = 0;
  for (const c of kept) {
    for (const [variant, price] of [["nonfoil", c.usd], ["foil", c.foil], ["etched", c.etched]] as const) {
      if (price == null) continue;
      const existing = (c.source === CARDTRADER_SOURCE ? ctSeries : c.source === CONVERTED_SOURCE ? cmSeries : c.source === CARD_KINGDOM_SOURCE ? ckSeries : series).get(`${c.id}|${variant}`);
      if (!existing && price < MIN_TRACKED_USD) continue;
      if (existing?.updatedDay === day) {
        seriesSkipped++;
        continue;
      }
      const next = setDay(existing ? { startDay: existing.startDay, prices: decodePrices(existing.prices) } : null, day, price);
      upserts.push({
        cardId: c.id, game: "mtg", variant, source: c.source ?? "tcgplayer", currency: "USD",
        startDay: next.startDay, prices: encodePrices(next.prices), updatedDay: day,
      });
    }
  }
  return { kept, mirrorRows, upserts, seriesSkipped };
}

/**
 * Pure: blank rows take their euro price in dollars (rounded to the cent) under the Cardmarket source; returns how many.
 * `lift` = lib/priceChain.ts CARDMARKET_LIFT (Magic 1.12, measured 10-19: Cardmarket runs 11-13% under TCGplayer).
 */
export function fillFromEuro(rows: MtgPriceRow[], usdPerEur: number, lift = 1): number {
  let n = 0;
  for (const r of rows) {
    const usd = r.eur != null ? Math.round(r.eur * usdPerEur * lift * 100) / 100 : null;
    const foil = r.eurFoil != null ? Math.round(r.eurFoil * usdPerEur * lift * 100) / 100 : null;
    if (usd == null && foil == null) continue;
    r.usd = usd;
    r.foil = foil;
    r.source = CONVERTED_SOURCE;
    n++;
  }
  return n;
}

/** From this price up a printing's cheapest live listing is kept (listing_lows) and caps it. */
export const CAP_MIN_USD = 10;
/**
 * Soft cap (10-16, Chris yes): pre-1996 printings and listings of $100+ are capped at SOFT_CAP_X the cheapest listing,
 * not at it. That listing is often a played or damaged copy, so old and dear cards ran low: eBay asks sat 1.46x over
 * capped pre-1996 prices (1.10x uncapped) and 1.56x over capped modern foils; sold checks agree (Alpha Blaze of Glory
 * $400 vs $579-$695 sold, Jace foil $134 vs $180-$205). 1.45 stays under the trust check's 1.5x edge (priceTrust test 4).
 */
export const SOFT_CAP_BEFORE = "1996-01-01";
export const SOFT_CAP_MIN_LOW_USD = 100;
export const SOFT_CAP_X = 1.45;

/**
 * The cheapest-listing cap (10-13, Chris "yes go ahead with both foil fixes"). TCGplayer's market price is its last sale,
 * and a foil that rarely sells keeps an old high one while copies sit listed far cheaper: 741 of the 837 Magic prices the
 * site hid that day were foils, 430 of them over 1.5x the cheapest copy for sale. A card can't be worth more than a copy
 * anyone can buy now, so a price over PRICE_TRUST.staleOverLow x that listing becomes the listing (eBay foil solds,
 * 10-13 sample: Cromat $155.59 -> $57.30 vs $65-$68 sold, Metamorphic Wurm $68.92 -> $1.30 vs $2-$8, Arena Swamp
 * $78.77 -> $35.75 vs $40-$49). The listing can be a played copy, so the cap runs a little low on mint, never high.
 *
 * One cheap copy is not the market (10-24, Chris yes): when the MIDDLE listing is at or over the price, most copies cost
 * that much and the cheapest is a played copy or carries high shipping (Heroic Intervention MAR 34: $7.67 + $5.99
 * shipping, mid $14.99, market $13.87). That printing is neither capped nor given a low for the guard's stale test; its
 * key comes back in `trusted`. That day 1,164 of the 2,833 capped printings were this case; 11 of 11 hand-checked on
 * TCGplayer had Near Mint copies at about the market (Opposition UDS foil $124.99 market, capped $77.99 LP, NM $126.43).
 * Mutates the rows; returns how many prices were capped and the listing_lows rows to store. Pure.
 */
export function capToListing(
  rows: MtgPriceRow[],
  tcgIdOf: Map<string, number>,
  lowsByProduct: Map<number, Record<string, ListingSpread>>,
  /** Release date per printing (Scryfall released_at); pre-1996 takes the soft cap. */
  releasedOf: Map<string, string> = new Map(),
): { capped: number; lows: ListingLow[]; trusted: string[] } {
  let capped = 0;
  const lows: ListingLow[] = [];
  const trusted: string[] = [];
  for (const r of rows) {
    if (r.source === CARDTRADER_SOURCE || r.source === CARD_KINGDOM_SOURCE) continue; // not TCGplayer numbers: a listing cap says nothing about them
    const l = lowsByProduct.get(tcgIdOf.get(r.id) ?? -1);
    if (!l) continue;
    for (const [field, variant, sub] of [["usd", "nonfoil", "Normal"], ["foil", "foil", "Foil"]] as const) {
      const price = r[field];
      const low = l[sub]?.low;
      if (price == null || price < CAP_MIN_USD || low == null) continue;
      const mid = l[sub].mid;
      if (mid != null && mid >= price) {
        trusted.push(`${r.id}|${variant}`);
        continue;
      }
      lows.push({ cardId: r.id, game: "mtg", variant, lowUsd: low });
      if (price >= PRICE_TRUST.staleOverLow * low) { // same edge as test 4: exactly 1.5x is too high
        const soft = (releasedOf.get(r.id) ?? "9999") < SOFT_CAP_BEFORE || low >= SOFT_CAP_MIN_LOW_USD;
        r[field] = soft ? Math.round(low * SOFT_CAP_X * 100) / 100 : low;
        capped++;
      }
    }
  }
  return { capped, lows, trusted };
}

/** A $100+ price whose last value has stood unchanged for PRICE_TRUST.stuckDays calendar days or more (the guard's test 4). */
function isStuckDear(prices: (number | null)[]): boolean {
  let i = prices.length - 1;
  while (i >= 0 && prices[i] == null) i--;
  if (i < 0) return false;
  const v = prices[i] as number;
  if (v < LOW_TRACKED_USD) return false;
  let j = i;
  for (let k = i - 1; k >= 0; k--) {
    if (prices[k] == null) continue;
    if (prices[k] !== v) break;
    j = k;
  }
  return i - j + 1 >= PRICE_TRUST.stuckDays;
}

export async function refreshMtgPricesFromBulk(day = todayUtc()): Promise<RefreshResult> {
  const index = await fetch(BULK_INDEX, { headers: HEADERS });
  if (!index.ok) throw new Error(`Scryfall bulk index: HTTP ${index.status}`);
  const meta = (await index.json()) as { download_uri?: string; jsonl_download_uri?: string; updated_at?: string };
  const url = meta.jsonl_download_uri ?? meta.download_uri;
  if (!url) throw new Error("Scryfall bulk index: no download URI");
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok || !res.body) throw new Error(`Scryfall bulk download: HTTP ${res.status}`);

  let scanned = 0;
  // The stream is collected first (with the async adapter a write can't be
  // interleaved into the stream callback; ~90k parsed rows are a few MB),
  // then everything is diffed in memory and written back in multi-row
  // batches — per-row statements were ~200k round trips on Turso.
  const pending: MtgPriceRow[] = [];
  const tcgIdOf = new Map<string, number>();
  const releasedOf = new Map<string, string>();
  const onCard = (obj: unknown) => {
    const c = obj as ScryfallCard;
    if (!c?.id || c.lang !== "en" || !c.prices) return;
    scanned++;
    if (c.tcgplayer_id) tcgIdOf.set(c.id, c.tcgplayer_id);
    if (c.released_at) releasedOf.set(c.id, c.released_at);
    pending.push({
      id: c.id,
      usd: num(c.prices.usd), foil: num(c.prices.usd_foil), etched: num(c.prices.usd_etched),
      eur: num(c.prices.eur), eurFoil: num(c.prices.eur_foil),
    });
  };
  if (url.endsWith(".jsonl.gz") || url.endsWith(".jsonl")) {
    // One JSON object per line; gunzip if the CDN handed us the .gz as-is.
    const raw = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
    const text = url.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
    for await (const line of createInterface({ input: text, crlfDelay: Infinity })) {
      if (!line) continue;
      try { onCard(JSON.parse(line)); } catch { /* skip malformed line */ }
    }
  } else {
    await streamJsonObjects(res.body, 2, onCard);
  }
  // Only printings we carry get written (the mirror's id set), and only the
  // ones whose prices moved; series already written today are skipped.
  const [mirror, existingSeries, ctSeries, cmSeries, ckSeries] = await Promise.all([
    readMtgCardPrices(),
    readSeriesMap("mtg", "tcgplayer"),
    readSeriesMap("mtg", CARDTRADER_SOURCE),
    readSeriesMap("mtg", CONVERTED_SOURCE),
    readSeriesMap("mtg", CARD_KINGDOM_SOURCE),
  ]);
  // Gold-stamped Art Series twins (scripts/sync-mtg-art.mjs, id "<plain>-s") are ours, not Scryfall's: the bulk file
  // never lists them, so they join the pending list blank and take TCGplayer's price with the other gaps (10-29).
  const listed = new Set(pending.map((c) => c.id));
  for (const id of mirror.keys()) if (id.endsWith("-s") && !listed.has(id)) pending.push({ id, usd: null, foil: null, etched: null, eur: null, eurFoil: null });
  // Printings Scryfall leaves without a dollar price (Art Series, Alpha/Beta,
  // Summer Magic…) take TCGplayer's (10-05). A failure only skips the fill.
  let tcgplayerFilled = 0;
  const lows: ListingLow[] = [];
  try {
    const gaps = pending.filter((c) => mirror.has(c.id) && c.usd == null && c.foil == null && c.etched == null);
    if (gaps.length) {
      const { fills } = await tcgplayerFills(await readMtgGapRows(gaps.map((g) => g.id)));
      const byId = new Map(pending.map((c) => [c.id, c]));
      for (const f of fills) {
        const row = byId.get(f.id);
        if (!row) continue;
        row.usd = f.usd;
        row.foil = f.foil;
        tcgplayerFilled++;
        // The cheapest live listing beside a $100+ market price: the guard's check on a market frozen on an old sale.
        if (f.usd != null && f.usd >= LOW_TRACKED_USD && f.usdLow) lows.push({ cardId: f.id, game: "mtg", variant: "nonfoil", lowUsd: f.usdLow });
        if (f.foil != null && f.foil >= LOW_TRACKED_USD && f.foilLow) lows.push({ cardId: f.id, game: "mtg", variant: "foil", lowUsd: f.foilLow });
      }
    }
  } catch (err) {
    console.warn("mtg tcgplayer fill:", err instanceof Error ? err.message : err);
  }
  // The rest of the chain (lib/priceChain.ts, Chris 10-19) fills what is still blank, in order: Cardmarket lifted 12%, then
  // Card Kingdom retail / 1.24, then CardTrader last. Released printings only (a pre-order price is not a market); a step's
  // failure only skips it. No 15x guard on Cardmarket or Card Kingdom: the nightly eBay referee reviews every $100+ price.
  const blank = (c: MtgPriceRow) => mirror.has(c.id) && c.usd == null && c.foil == null && c.etched == null;
  const releasedIds = async (ids: string[]) => new Set((await readMtgGapRows(ids)).filter((r) => (r.released ?? "") !== "" && (r.released ?? "") <= day).map((r) => r.id));
  // Step 3: Scryfall's Cardmarket euro price at today's ECB rate, lifted (10-13, Chris: "show the euro price, let the ebay
  // check review it"; 425 older printings: Alpha/Beta power, Summer Magic, serialized cards).
  let cardmarketFilled = 0;
  try {
    const left = pending.filter((c) => blank(c) && (c.eur != null || c.eurFoil != null));
    if (left.length) {
      const released = await releasedIds(left.map((c) => c.id));
      const rate = released.size ? await (await import("@/lib/server/fx")).usdPerEur().catch(() => null) : null;
      if (rate) cardmarketFilled = fillFromEuro(left.filter((c) => released.has(c.id)), rate, cardmarketLift("mtg"));
    }
  } catch (err) {
    console.warn("mtg cardmarket euro fill:", err instanceof Error ? err.message : err);
  }
  // Step 4: Card Kingdom's public price list (10-19), retail / 1.24, keyed by Scryfall id. One ~47 MB download a run,
  // fetched only when a blank row is left.
  let cardkingdomFilled = 0;
  try {
    const left = pending.filter(blank);
    if (left.length) {
      const released = await releasedIds(left.map((c) => c.id));
      if (released.size) {
        const rows = (await readMtgGapRows([...released])).filter((r) => (r.released ?? "") <= day);
        const oracleMax = await readOracleMaxUsd([...new Set(rows.map((r) => r.oracleId ?? "").filter(Boolean))]);
        cardkingdomFilled = cardkingdomFills(left, await fetchCardkingdomList(), released, (fills) => guardFills(fills, rows, oracleMax));
      }
    }
  } catch (err) {
    console.warn("mtg card kingdom fill:", err instanceof Error ? err.message : err);
  }
  // Step 5, last resort (8th/9th Edition foil ★, Introductory Two-Player Set…): CardTrader's cheapest Near Mint English
  // listing (10-06), same 15× guard. Needs CARDTRADER_TOKEN; capped at 45 s, biggest sets first.
  let cardtraderFilled = 0;
  const token = process.env.CARDTRADER_TOKEN?.trim();
  if (token) {
    try {
      const left = pending.filter(blank);
      const rows = (await readMtgGapRows(left.map((g) => g.id))).filter((r) => (r.released ?? "") <= day);
      if (rows.length) {
        const rate = await (await import("@/lib/server/fx")).usdPerEur().catch(() => null);
        const raw = await cardtraderMtgPrices(rows, token, rate);
        const fills = guardFills(raw, rows, await readOracleMaxUsd([...new Set(rows.map((r) => r.oracleId ?? "").filter(Boolean))]));
        const byId = new Map(pending.map((c) => [c.id, c]));
        for (const f of fills) {
          const row = byId.get(f.id);
          if (!row) continue;
          row.usd = f.usd;
          row.foil = f.foil;
          row.source = CARDTRADER_SOURCE;
          cardtraderFilled++;
        }
      }
    } catch (err) {
      console.warn("mtg cardtrader fill:", err instanceof Error ? err.message : err);
    }
  }
  // Cap at the cheapest live listing and keep that listing for the trust check (capToListing). A failure only skips it.
  let cappedToListing = 0;
  let listingTrusted: string[] = [];
  try {
    const r = capToListing(pending.filter((c) => mirror.has(c.id)), tcgIdOf, await allListingLows(), releasedOf);
    cappedToListing = r.capped;
    listingTrusted = r.trusted;
    const have = new Set(lows.map((l) => `${l.cardId}|${l.variant}`));
    lows.push(...r.lows.filter((l) => !have.has(`${l.cardId}|${l.variant}`)));
  } catch (err) {
    console.warn("mtg listing cap:", err instanceof Error ? err.message : err);
  }
  const plan = planMtgWrites(pending, mirror, existingSeries, day, ctSeries, cmSeries, ckSeries);
  await updateMtgPriceColumns(plan.mirrorRows);
  await upsertSeriesRows(plan.upserts);
  // Scryfall's own dollar prices are TCGplayer's market too, so they freeze the same way: every $100+ printing stuck 45+ days
  // also gets its cheapest live listing read (one tcgcsv pass over just their sets, ~400 cards on 10-07). A failure only skips it.
  // A printing the middle listing backs (capToListing `trusted`) gets no low here either: one cheap copy is not a freeze.
  try {
    const have = new Set([...lows.map((l) => `${l.cardId}|${l.variant}`), ...listingTrusted]);
    const stuck =[...existingSeries].filter(([key, s]) => !have.has(key) && isStuckDear(decodePrices(s.prices))).map(([key]) => key);
    if (stuck.length) {
      const want = new Set(stuck);
      const { fills } = await tcgplayerFills(await readMtgGapRows([...new Set(stuck.map((k) => k.split("|")[0]))].slice(0, 1500)));
      for (const f of fills) {
        if (f.usdLow && want.has(`${f.id}|nonfoil`)) lows.push({ cardId: f.id, game: "mtg", variant: "nonfoil", lowUsd: f.usdLow });
        if (f.foilLow && want.has(`${f.id}|foil`)) lows.push({ cardId: f.id, game: "mtg", variant: "foil", lowUsd: f.foilLow });
      }
    }
  } catch (err) {
    console.warn("mtg stuck listing lows:", err instanceof Error ? err.message : err);
  }
  await upsertListingLows(lows, day).catch((err) => console.warn("mtg listing lows:", err instanceof Error ? err.message : err));
  return {
    scanned,
    updated: plan.kept.length,
    seriesTouched: plan.upserts.length,
    day,
    mirrorChanged: plan.mirrorRows.length,
    seriesSkipped: plan.seriesSkipped,
    tcgplayerFilled,
    cardtraderFilled,
    cardmarketFilled,
    cardkingdomFilled,
    cappedToListing,
  };
}
