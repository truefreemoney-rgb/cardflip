// Magic printing → TCGplayer product id, from Scryfall's own bulk file (10-12).
//
// Chris 10-12: "33 days is kind of ridiculous". The Scryfall guard allows 3,000
// pictures a day, so Magic's ~99k pictures would take a month from Scryfall
// alone. Scryfall's card objects carry each printing's tcgplayer_id, so one
// bulk download (Scryfall asks people to use bulk files) lets save-pictures
// fetch most Magic pictures from TCGplayer's CDN instead; only printings with
// no TCGplayer product (or a 403/404 there) fall back to Scryfall.
//
//   node scripts/mtg-tcgplayer-ids.mjs        → data/mtg-tcgplayer-ids.json { <scryfall id>: <tcgplayer id> }
//
// Two Scryfall requests total (bulk index + the file), both through the guard.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { scryfallFetch } from "./lib/scryfall-guard.mjs";

const OUT = path.join(process.cwd(), "data", "mtg-tcgplayer-ids.json");
const FILE = path.join(process.cwd(), "data", "scryfall-default-cards.jsonl.gz");

if (!fs.existsSync(FILE) || Date.now() - fs.statSync(FILE).mtimeMs > 20 * 3600e3) {
  const meta = await (await scryfallFetch("https://api.scryfall.com/bulk-data/default-cards")).json();
  const uri = meta.jsonl_download_uri ?? meta.download_uri;
  console.log(`downloading ${uri} (${Math.round((meta.compressed_size ?? meta.size) / 1e6)} MB)`);
  const res = await scryfallFetch(uri, { headers: { Accept: "*/*" } });
  if (!res.ok) throw new Error(`bulk download → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(FILE));
}

const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"), { readOnly: true });
const want = new Set(db.prepare("SELECT id FROM mtg_cards WHERE image_url <> ''").all().map((r) => r.id));

// The bulk file (10-12: .jsonl.gz) holds one card object per line; the older .json array form parses too.
const ids = {};
let seen = 0;
for await (const line of readline.createInterface({ input: fs.createReadStream(FILE).pipe(zlib.createGunzip()), crlfDelay: Infinity })) {
  const t = line.trim().replace(/,$/, "");
  if (!t.startsWith("{")) continue;
  const c = JSON.parse(t);
  seen++;
  if (want.has(c.id) && c.tcgplayer_id) ids[c.id] = c.tcgplayer_id;
}
fs.writeFileSync(OUT, JSON.stringify(ids));
console.log(`${seen} cards in the bulk file; ${Object.keys(ids).length} of our ${want.size} Magic printings have a TCGplayer product → ${OUT}`);
