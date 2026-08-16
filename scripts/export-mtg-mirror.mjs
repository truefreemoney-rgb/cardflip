#!/usr/bin/env node
// Packs the local Magic mirror (mtg_sets + mtg_cards, synced by
// scripts/sync-mtg.mjs) into seed/mtg-mirror.db.gz, which ships in the
// Docker image and is imported on boot by src/lib/db.ts (seedMtgMirror).
//
// Why: Scryfall throttles Fly's egress IP so the sync can't run on the
// machine; it runs fine from a home connection. Refresh cycle:
//   npm run sync:mtg && npm run export:mtg && flyctl deploy --app cardflip-superior
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const src = process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db");
const seedDir = path.join(process.cwd(), "seed");
const tmp = path.join(seedDir, "mtg-mirror.db");
const out = path.join(seedDir, "mtg-mirror.db.gz");
fs.mkdirSync(seedDir, { recursive: true });
try { fs.unlinkSync(tmp); } catch {}

const db = new DatabaseSync(tmp);
db.exec(`ATTACH DATABASE 'file:${src.replace(/\\/g, "/").replace(/'/g, "''")}?mode=ro' AS srcdb`);
db.exec("CREATE TABLE mtg_sets AS SELECT * FROM srcdb.mtg_sets");
db.exec("CREATE TABLE mtg_cards AS SELECT * FROM srcdb.mtg_cards");
// Price history for every game rides along (sync-mtg / backfill-mtgjson / backfill-tcgcsv);
// the app merges it with INSERT OR IGNORE so prod keeps any points it already holds.
const hasHistory = db.prepare("SELECT 1 FROM srcdb.sqlite_master WHERE type = 'table' AND name = 'price_series'").get();
// Real primary keys, not CREATE ... AS SELECT: the app's import does per-key
// lookups against this table, and without the index a 176k-series merge is a
// full scan per row (hours; prod v105 stalled ~2 min on 84k).
db.exec(`CREATE TABLE price_series (
  card_id TEXT NOT NULL, game TEXT NOT NULL, variant TEXT NOT NULL, source TEXT NOT NULL,
  currency TEXT NOT NULL, start_day TEXT NOT NULL, prices TEXT NOT NULL, updated_day TEXT NOT NULL,
  PRIMARY KEY (card_id, variant, source))`);
if (hasHistory) db.exec("INSERT INTO price_series SELECT card_id, game, variant, source, currency, start_day, prices, updated_day FROM srcdb.price_series");
// TCGplayer productId → card map (Pokémon), for the server's daily TCGCSV refresh.
const hasMap = db.prepare("SELECT 1 FROM srcdb.sqlite_master WHERE type = 'table' AND name = 'tcgplayer_products'").get();
db.exec("CREATE TABLE tcgplayer_products (product_id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, card_id TEXT NOT NULL, game TEXT NOT NULL)");
if (hasMap) db.exec("INSERT INTO tcgplayer_products SELECT product_id, group_id, card_id, game FROM srcdb.tcgplayer_products");
db.exec("DETACH DATABASE srcdb");
db.exec("VACUUM");
const counts = db.prepare("SELECT (SELECT COUNT(*) FROM mtg_cards) cards, (SELECT COUNT(*) FROM mtg_sets) sets, (SELECT COUNT(*) FROM price_series) series").get();
db.close();
if (!counts.cards) {
  console.error("Local mirror is empty — run npm run sync:mtg first");
  process.exit(1);
}
fs.writeFileSync(out, zlib.gzipSync(fs.readFileSync(tmp), { level: 9 }));
fs.unlinkSync(tmp);
console.log(`seed/mtg-mirror.db.gz: ${counts.cards} printings, ${counts.sets} sets, ${counts.series} price series, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
