import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { streamJsonObjects } from "@/lib/server/jsonStream";
import { decodePrices, encodePrices, setDay, todayUtc } from "@/lib/priceSeries";

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
}

export async function refreshMtgPricesFromBulk(day = todayUtc()): Promise<RefreshResult> {
  const index = await fetch(BULK_INDEX, { headers: HEADERS });
  if (!index.ok) throw new Error(`Scryfall bulk index: HTTP ${index.status}`);
  const meta = (await index.json()) as { download_uri?: string; jsonl_download_uri?: string; updated_at?: string };
  const url = meta.jsonl_download_uri ?? meta.download_uri;
  if (!url) throw new Error("Scryfall bulk index: no download URI");
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok || !res.body) throw new Error(`Scryfall bulk download: HTTP ${res.status}`);

  const update = db.prepare(
    `UPDATE mtg_cards SET price_usd = ?, price_usd_foil = ?, price_usd_etched = ?, price_eur = ?, price_eur_foil = ?
      WHERE id = ?`,
  );
  const selectRow = db.prepare(
    "SELECT start_day, prices FROM price_series WHERE card_id = ? AND variant = ? AND source = ?",
  );
  const upsertRow = db.prepare(
    `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
     VALUES (?, 'mtg', ?, 'tcgplayer', 'USD', ?, ?, ?)`,
  );

  let scanned = 0, updated = 0, seriesTouched = 0;
  // Short transactions in batches: the stream takes minutes, and a single
  // long write lock would make every other write in the app hit busy_timeout.
  const BATCH = 500;
  let pending: { id: string; usd: number | null; foil: number | null; etched: number | null; eur: number | null; eurFoil: number | null }[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    db.exec("BEGIN");
    try {
      for (const c of pending) {
        const r = update.run(c.usd, c.foil, c.etched, c.eur, c.eurFoil, c.id);
        if (Number(r.changes) === 0) continue; // not a printing we carry
        updated++;
        for (const [variant, price] of [["nonfoil", c.usd], ["foil", c.foil], ["etched", c.etched]] as const) {
          if (price == null) continue;
          const existing = selectRow.get(c.id, variant, "tcgplayer") as { start_day: string; prices: string } | undefined;
          if (!existing && price < MIN_TRACKED_USD) continue;
          const next = setDay(existing ? { startDay: existing.start_day, prices: decodePrices(existing.prices) } : null, day, price);
          upsertRow.run(c.id, variant, next.startDay, encodePrices(next.prices), day);
          seriesTouched++;
        }
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    pending = [];
  };
  const onCard = (obj: unknown) => {
    const c = obj as ScryfallCard;
    if (!c?.id || c.lang !== "en" || !c.prices) return;
    scanned++;
    pending.push({
      id: c.id,
      usd: num(c.prices.usd), foil: num(c.prices.usd_foil), etched: num(c.prices.usd_etched),
      eur: num(c.prices.eur), eurFoil: num(c.prices.eur_foil),
    });
    if (pending.length >= BATCH) flush();
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
  flush();
  return { scanned, updated, seriesTouched, day };
}
