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
// --game pokemon reads en_cards instead (same three columns); its TCGdex
// low.webp links are saved from the high.webp twin.
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
// --only tcgplayer|scryfall (Magic): one source at a time, so the Scryfall share can run alongside another TCGplayer run.
const only = opt("--only", "");
// --resave-host <host>: save again rows already saved from that host (10-12: pokemontcg.io rows got the 245px PNG, not _hires).
const resaveHost = opt("--resave-host", "");
if (!/^(lorcana|onepiece|yugioh|pokemon|mtg)$/.test(game)) {
  console.error("usage: --game lorcana|onepiece|yugioh|pokemon|mtg [--limit N] [--dry] [--sheet out.png] [--prod] [--only tcgplayer|scryfall] [--resave-host host]");
  process.exit(2);
}

const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"), { timeout: 15000 }); // two runs can share the file
// Pokémon lives in its own table (en_cards, 10-12): same three columns, its own set / number names.
const T = game === "pokemon"
  ? { table: "en_cards", where: "1 = 1", set: "set_id", num: "local_id", args: [] }
  : game === "mtg"
    ? { table: "mtg_cards", where: "1 = 1", set: "set_code", num: "collector_number", args: [] }
    : { table: "tcg_cards", where: "game = ?", set: "set_code", num: "collector_number", args: [game] };
// Magic (10-12): TCGplayer's scan of the same printing when Scryfall names its product (scripts/mtg-tcgplayer-ids.mjs),
// so ~94k of ~99k pictures skip the Scryfall guard's 3,000/day; a 403/404 there falls back to Scryfall
// (not under --only tcgplayer: those rows fail and a plain run without --only picks them up later).
const mtgTcg = game === "mtg" ? JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "mtg-tcgplayer-ids.json"), "utf8")) : {};
// TCGdex rows store the small low.webp; the saved copies are made from its high.webp twin. pokemontcg.io's
// plain PNG is a 245px thumbnail; its _hires twin is the real picture (vision.ts does the same).
const fetchUrlOf = (src, id) => {
  if (mtgTcg[id]) return `https://tcgplayer-cdn.tcgplayer.com/product/${mtgTcg[id]}_in_1000x1000.jpg`;
  if (/^https:\/\/assets\.tcgdex\.net\/.*\/low\.webp$/.test(src)) return src.replace(/\/low\.webp$/, "/high.webp");
  if (/^https:\/\/images\.pokemontcg\.io\/.*\.png$/.test(src) && !/_hires\.png$/.test(src)) return src.replace(/\.png$/, "_hires.png");
  return src;
};
const COLUMNS = ["own_image_url TEXT NOT NULL DEFAULT ''", "own_tile_url TEXT NOT NULL DEFAULT ''", "own_image_src TEXT NOT NULL DEFAULT ''"];
const have = new Set(db.prepare(`PRAGMA table_info(${T.table})`).all().map((c) => c.name));
for (const col of COLUMNS) if (!have.has(col.split(" ")[0])) db.exec(`ALTER TABLE ${T.table} ADD COLUMN ${col}`);

let prod = null;
if (prodFlag && !dry) {
  const { createClient } = await import("@libsql/client");
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
  prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
  for (const col of COLUMNS) {
    try {
      await prod.execute(`ALTER TABLE ${T.table} ADD COLUMN ${col}`);
    } catch (err) {
      if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
    }
  }
}

const rows = db
  .prepare(
    `SELECT id, name, ${T.set} AS set_code, ${T.num} AS collector_number, image_url, own_image_url, own_tile_url, own_image_src
       FROM ${T.table} WHERE ${T.where} AND image_url <> '' AND (own_image_src <> image_url${resaveHost ? " OR image_url LIKE ?" : ""})
      ORDER BY set_release_date DESC, ${T.set}, ${T.num}`,
  )
  .all(...T.args, ...(resaveHost ? [`https://${resaveHost}/%`] : []))
  .filter((r) => !only || (only === "tcgplayer") === Boolean(mtgTcg[r.id]))
  .slice(0, limit || undefined);
const total = db.prepare(`SELECT COUNT(*) AS n FROM ${T.table} WHERE ${T.where} AND image_url <> ''`).get(...T.args).n;
console.log(`${game}: ${rows.length} of ${total} pictures to save${dry ? " (DRY, nothing uploaded or written)" : ""}${prod ? ", prod too" : ""}`);

const PROD_SQL = `UPDATE ${T.table} SET own_image_url = ?, own_tile_url = ?, own_image_src = ? WHERE id = ?`;
const setRow = db.prepare(PROD_SQL);
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
      const saved = await savePicture({ game, id: row.id, src: row.image_url, fetchUrl: fetchUrlOf(row.image_url, row.id), dry, fallback: only !== "tcgplayer" });
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
