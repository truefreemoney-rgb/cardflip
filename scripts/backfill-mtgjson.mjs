/**
 * Backfill ~90 days of Magic price history from MTGJSON into the local
 * price_series table, so Magic charts aren't empty on day one.
 *
 *   npm run backfill:mtg            # download + import (~380 MB of downloads)
 *   npm run backfill:mtg -- --keep  # keep the downloads in data/mtgjson/
 *
 * Then `npm run export:mtg` and deploy — the seed carries the table to prod.
 *
 * MTGJSON keys prices by its own uuid, so two files are needed:
 *   AllIdentifiers.json.gz  → uuid → identifiers.scryfallId   (~60 MB gz)
 *   AllPrices.json.gz       → uuid → paper.{tcgplayer,cardmarket}.retail.{normal,foil,etched}.{date: price}
 * Both are hundreds of MB uncompressed, so they are streamed and split at the
 * top-level "data" object's children (one card per JSON.parse) instead of
 * being parsed whole. Only paper TCGplayer retail (USD) is used, and only
 * series that ever reach 50¢ — the row-per-day version of this table hit
 * 6.4 GB; the compact per-series rows (lib/priceSeries.ts) with those two
 * filters land around 30 MB. Existing rows are replaced (the seed is the
 * authority for Magic history). Sources: https://mtgjson.com/downloads/all-files/
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { dayIndex, encodePrices } from "../src/lib/priceSeries.ts";

const keep = process.argv.includes("--keep");
const dataDir = path.join(process.cwd(), "data");
const cacheDir = path.join(dataDir, "mtgjson");
const dbPath = process.env.CARDFLIP_DB_PATH ?? path.join(dataDir, "cardflip.db");
fs.mkdirSync(cacheDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS price_series (
    card_id TEXT NOT NULL, game TEXT NOT NULL, variant TEXT NOT NULL, source TEXT NOT NULL,
    currency TEXT NOT NULL, start_day TEXT NOT NULL, prices TEXT NOT NULL, updated_day TEXT NOT NULL,
    PRIMARY KEY (card_id, variant, source)
  );
`);
const known = new Set(db.prepare("SELECT id FROM mtg_cards").all().map((r) => r.id));
if (known.size === 0) {
  console.error("Local Magic mirror is empty — run npm run sync:mtg first");
  process.exit(1);
}
console.log(`mirror: ${known.size} printings`);

/**
 * Stream a gzipped MTGJSON file and call `onEntry(key, obj)` for each child
 * of the top-level "data" object. Depth-tracks braces outside strings; the
 * "meta" object is skipped by only emitting once we've seen the "data" key.
 */
async function streamData(url, file, onEntry) {
  if (!fs.existsSync(file)) {
    console.log(`downloading ${url}`);
    const res = await fetch(url, { headers: { "User-Agent": "CardFlip/1.0 (price-history backfill)" } });
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  }
  // Layout: { "meta": {...}, "data": { "<uuid>": {...}, ... } }
  //   depth 1 = inside the root object (keys "meta"/"data")
  //   depth 2 = inside "data" (keys are uuids)      ← inData
  //   depth 3 = a uuid's value                       ← capture it whole
  let depth = 0;
  let inString = false;
  let escape = false;
  let strBuf = "";        // content of the string being read (when not capturing)
  let lastKey = "";       // most recent completed string at the current depth
  let inData = false;
  let capturing = false;
  let buf = "";
  let currentKey = "";
  let entries = 0;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString("utf8");
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (capturing) buf += ch;
        if (inString) {
          if (escape) escape = false;
          else if (ch === "\\") escape = true;
          else if (ch === '"') {
            inString = false;
            if (!capturing) lastKey = strBuf;
          } else if (!capturing) strBuf += ch;
          continue;
        }
        if (ch === '"') { inString = true; strBuf = ""; continue; }
        if (ch === "{" || ch === "[") {
          depth++;
          if (depth === 2 && lastKey === "data") inData = true;
          else if (depth === 3 && inData && !capturing) { capturing = true; buf = ch; currentKey = lastKey; }
          continue;
        }
        if (ch === "}" || ch === "]") {
          if (capturing && depth === 3) {
            capturing = false;
            try { onEntry(currentKey, JSON.parse(buf)); entries++; } catch { /* skip malformed */ }
            buf = "";
            if (entries % 20000 === 0) process.stdout.write(`  ${entries} entries\r`);
          }
          depth--;
          if (depth === 1) inData = false;
          continue;
        }
      }
      cb();
    },
  });
  await pipeline(fs.createReadStream(file), zlib.createGunzip(), sink);
  console.log(`  ${entries} entries in ${path.basename(file)}`);
}

// 1. uuid → scryfall id (only for printings we actually have)
const uuidToScryfall = new Map();
await streamData(
  "https://mtgjson.com/api/v5/AllIdentifiers.json.gz",
  path.join(cacheDir, "AllIdentifiers.json.gz"),
  (uuid, card) => {
    const sid = card?.identifiers?.scryfallId;
    if (sid && known.has(sid)) uuidToScryfall.set(uuid, sid);
  },
);
console.log(`mapped ${uuidToScryfall.size} MTGJSON uuids to mirror printings`);

// 2. prices — accumulate {day: price} per (card, finish) in memory, then write
//    one compact row per series.
const FINISH = { normal: "nonfoil", foil: "foil", etched: "etched" };
const MIN_TRACKED_USD = 0.5;
const acc = new Map(); // key card|variant → Map(day → price)
await streamData(
  "https://mtgjson.com/api/v5/AllPrices.json.gz",
  path.join(cacheDir, "AllPrices.json.gz"),
  (uuid, entry) => {
    const sid = uuidToScryfall.get(uuid);
    if (!sid) return;
    const retail = entry?.paper?.tcgplayer?.retail;
    if (!retail) return;
    for (const [finish, variant] of Object.entries(FINISH)) {
      const series = retail[finish];
      if (!series) continue;
      const key = `${sid}|${variant}`;
      let m = acc.get(key);
      for (const [day, price] of Object.entries(series)) {
        if (typeof price !== "number" || !(price > 0)) continue;
        if (!m) { m = new Map(); acc.set(key, m); }
        m.set(day, price);
      }
    }
  },
);
console.log(`${acc.size} raw series`);

const upsert = db.prepare(
  `INSERT OR REPLACE INTO price_series (card_id, game, variant, source, currency, start_day, prices, updated_day)
   VALUES (?, 'mtg', ?, 'tcgplayer', 'USD', ?, ?, ?)`,
);
let written = 0, skipped = 0, points = 0;
db.exec("BEGIN");
for (const [key, m] of acc) {
  const [sid, variant] = key.split("|");
  const days = [...m.keys()].sort();
  let max = 0;
  for (const v of m.values()) if (v > max) max = v;
  if (max < MIN_TRACKED_USD) { skipped++; continue; }
  const start = days[0], end = days[days.length - 1];
  const len = dayIndex(start, end) + 1;
  const arr = new Array(len).fill(null);
  for (const [day, price] of m) arr[dayIndex(start, day)] = Math.round(price * 100) / 100;
  upsert.run(sid, variant, start, encodePrices(arr), end);
  written++;
  points += m.size;
}
db.exec("COMMIT");
const span = db.prepare("SELECT MIN(start_day) lo, MAX(updated_day) hi, COUNT(*) n FROM price_series WHERE game = 'mtg'").get();
console.log(`wrote ${written} series (${points} points), skipped ${skipped} under $${MIN_TRACKED_USD}; mtg series now ${span.n}, ${span.lo} → ${span.hi}`);
db.close();
if (!keep) {
  for (const f of ["AllIdentifiers.json.gz", "AllPrices.json.gz"]) {
    try { fs.unlinkSync(path.join(cacheDir, f)); } catch {}
  }
}
