// Self-host card pictures, one game at a time (Chris 10-12: "find card, save
// to our database and everything pulls from there"). Each tcg_cards row's
// source picture (image_url) is fetched once through scripts/lib/save-picture.mjs,
// stored in our Blob as a ~500px page copy + 240px tile, and the row gets:
//
//   own_image_url   our page copy
//   own_tile_url    our list tile
//   own_image_src   the source URL that was saved (a changed source = re-save)
//
// image_url keeps the source link (the weekly sync still writes it), so a
// row with own_image_src == image_url is done and skipped. Readers prefer
// own_* and fall back to image_url until a game is fully backfilled.
//
//   node --env-file=.env.local scripts/save-pictures.mjs --game lorcana --dry --limit 12 --sheet out.png
//   node --env-file=.env.local scripts/save-pictures.mjs --game lorcana [--limit N] [--prod]
//
// --dry: fetch + resize only, no upload, no row written; --sheet writes a
// contact sheet PNG of the tiles. --prod replays the row updates to Turso
// (.env.migration.json) in batches of 200 after the local writes. Stops on
// the first 429 or the source's daily cap (exit 3); rerun tomorrow, it
// picks up where it left off.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { contactSheet, deletePictures, savePicture, StopRun } from "./lib/save-picture.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const game = opt("--game", "");
const limit = Number(opt("--limit", "0")) || 0;
const dry = args.includes("--dry");
const sheet = opt("--sheet", "");
const prodFlag = args.includes("--prod");
const WORKERS = Number(opt("--workers", "4")) || 4;
if (!/^(lorcana|onepiece|yugioh)$/.test(game)) {
  console.error("usage: --game lorcana|onepiece|yugioh [--limit N] [--dry] [--sheet out.png] [--prod]");
  process.exit(2);
}

const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"));
const COLUMNS = ["own_image_url TEXT NOT NULL DEFAULT ''", "own_tile_url TEXT NOT NULL DEFAULT ''", "own_image_src TEXT NOT NULL DEFAULT ''"];
const have = new Set(db.prepare("PRAGMA table_info(tcg_cards)").all().map((c) => c.name));
for (const col of COLUMNS) if (!have.has(col.split(" ")[0])) db.exec(`ALTER TABLE tcg_cards ADD COLUMN ${col}`);

let prod = null;
if (prodFlag && !dry) {
  const { createClient } = await import("@libsql/client");
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
  for (const col of COLUMNS) {
    try {
      await prod.execute(`ALTER TABLE tcg_cards ADD COLUMN ${col}`);
    } catch (err) {
      if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
    }
  }
}

const rows = db
  .prepare(
    `SELECT id, name, set_code, collector_number, image_url, own_image_url, own_tile_url, own_image_src
       FROM tcg_cards WHERE game = ? AND image_url <> '' AND own_image_src <> image_url
      ORDER BY set_release_date DESC, set_code, collector_number${limit ? ` LIMIT ${limit}` : ""}`,
  )
  .all(game);
const total = db.prepare("SELECT COUNT(*) AS n FROM tcg_cards WHERE game = ? AND image_url <> ''").get(game).n;
console.log(`${game}: ${rows.length} of ${total} pictures to save${dry ? " (DRY, nothing uploaded or written)" : ""}${prod ? ", prod too" : ""}`);

const setRow = db.prepare("UPDATE tcg_cards SET own_image_url = ?, own_tile_url = ?, own_image_src = ? WHERE id = ?");
const PROD_SQL = "UPDATE tcg_cards SET own_image_url = ?, own_tile_url = ?, own_image_src = ? WHERE id = ?";
const prodStmts = [];
const tiles = [];
const bytes = { source: 0, page: 0, tile: 0 };
let done = 0;
let failed = 0;
let stop = null;
let next = 0;

async function flushProd(force = false) {
  if (!prod || (!force && prodStmts.length < 200)) return;
  const batch = prodStmts.splice(0, prodStmts.length);
  if (batch.length) await prod.batch(batch, "write");
}

async function worker() {
  while (!stop) {
    const row = rows[next++];
    if (!row) return;
    try {
      const saved = await savePicture({ game, id: row.id, src: row.image_url, dry });
      bytes.source += saved.bytes.source;
      bytes.page += saved.bytes.page;
      bytes.tile += saved.bytes.tile;
      if (sheet && tiles.length < 60) tiles.push({ buf: saved.tileBuf ?? (await (await fetch(saved.tile)).arrayBuffer().then(Buffer.from)), label: `${row.name} ${row.set_code} ${row.collector_number}` });
      if (!dry) {
        setRow.run(saved.url, saved.tile, row.image_url, row.id);
        prodStmts.push({ sql: PROD_SQL, args: [saved.url, saved.tile, row.image_url, row.id] });
        await flushProd();
        if (row.own_image_url && row.own_image_url !== saved.url) await deletePictures([row.own_image_url, row.own_tile_url]);
      }
      done++;
    } catch (err) {
      if (err instanceof StopRun) {
        stop = err;
        return;
      }
      failed++;
      console.warn(`  ${row.id} (${row.name}): ${err?.message ?? err}`);
    }
    if ((done + failed) % 25 === 0) process.stdout.write(`  ${done + failed}/${rows.length}  ok ${done} failed ${failed}\r`);
  }
}

await Promise.all(Array.from({ length: WORKERS }, worker));
await flushProd(true);

const kb = (n) => (n / 1024).toFixed(1);
console.log(`\n${game}: saved ${done}, failed ${failed}${dry ? " (dry)" : ""}. Average per card: source ${kb(bytes.source / Math.max(done, 1))} KB → page ${kb(bytes.page / Math.max(done, 1))} KB + tile ${kb(bytes.tile / Math.max(done, 1))} KB`);
if (sheet && tiles.length) {
  await contactSheet(tiles, sheet);
  console.log(`contact sheet: ${sheet} (${tiles.length} tiles)`);
}
if (stop) {
  console.error(`\nSTOPPED: ${stop.message}`);
  process.exit(3);
}
