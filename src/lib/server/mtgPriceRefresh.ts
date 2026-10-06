import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { streamJsonObjects } from "@/lib/server/jsonStream";
import { guardFills, readMtgGapRows, readOracleMaxUsd, tcgplayerFills } from "@/lib/server/mtgTcgplayerFill";
import { CARDTRADER_SOURCE, cardtraderMtgPrices } from "@/lib/server/cardtrader";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";
import {
  readMtgCardPrices,
  readSeriesMap,
  updateMtgPriceColumns,
  upsertSeriesRows,
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
  /** Rows still blank that took CardTrader's cheapest NM listing. */
  cardtraderFilled?: number;
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
): { kept: MtgPriceRow[]; mirrorRows: MtgPriceRow[]; upserts: SeriesUpsert[]; seriesSkipped: number } {
  const kept = pending.filter((c) => mirror.has(c.id));
  const same = (a: MtgPriceRow, b: MtgPriceRow) => a.usd === b.usd && a.foil === b.foil && a.etched === b.etched && a.eur === b.eur && a.eurFoil === b.eurFoil;
  const mirrorRows = kept.filter((c) => !same(c, mirror.get(c.id)!));
  const upserts: SeriesUpsert[] = [];
  let seriesSkipped = 0;
  for (const c of kept) {
    for (const [variant, price] of [["nonfoil", c.usd], ["foil", c.foil], ["etched", c.etched]] as const) {
      if (price == null) continue;
      const existing = (c.source === CARDTRADER_SOURCE ? ctSeries : series).get(`${c.id}|${variant}`);
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
  const onCard = (obj: unknown) => {
    const c = obj as ScryfallCard;
    if (!c?.id || c.lang !== "en" || !c.prices) return;
    scanned++;
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
  const [mirror, existingSeries, ctSeries] = await Promise.all([readMtgCardPrices(), readSeriesMap("mtg", "tcgplayer"), readSeriesMap("mtg", CARDTRADER_SOURCE)]);
  // Printings Scryfall leaves without a dollar price (Art Series, Alpha/Beta,
  // Summer Magic…) take TCGplayer's (10-05). A failure only skips the fill.
  let tcgplayerFilled = 0;
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
      }
    }
  } catch (err) {
    console.warn("mtg tcgplayer fill:", err instanceof Error ? err.message : err);
  }
  // Still blank after TCGplayer (8th/9th Edition foil ★, Introductory Two-Player
  // Set…): CardTrader's cheapest Near Mint English listing (10-06), same 15×
  // guard. Needs CARDTRADER_TOKEN; capped at 45 s, biggest sets first.
  let cardtraderFilled = 0;
  const token = process.env.CARDTRADER_TOKEN?.trim();
  if (token) {
    try {
      const left = pending.filter((c) => mirror.has(c.id) && c.usd == null && c.foil == null && c.etched == null);
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
  const plan = planMtgWrites(pending, mirror, existingSeries, day, ctSeries);
  await updateMtgPriceColumns(plan.mirrorRows);
  await upsertSeriesRows(plan.upserts);
  return {
    scanned,
    updated: plan.kept.length,
    seriesTouched: plan.upserts.length,
    day,
    mirrorChanged: plan.mirrorRows.length,
    seriesSkipped: plan.seriesSkipped,
    tcgplayerFilled,
    cardtraderFilled,
  };
}
