// One-time cleanup (10-14): TCGdex files four Trainer Gallery subsets twice (swsh9tg and swsh9.5tg, same cards),
// so Search listed each card twice. sync-cards.mjs now skips the ".5" copies; this moves anything that points at
// one (a customer's card, a watch) to the kept copy and deletes the ".5" rows.
//
//   node scripts/drop-duplicate-tg-sets.mjs            local, dry run (counts only)
//   node scripts/drop-duplicate-tg-sets.mjs --apply    local, for real
//   node scripts/drop-duplicate-tg-sets.mjs --prod [--apply]
import fs from "node:fs";
import { createClient } from "@libsql/client";

const DUP = { "swsh9.5tg": "swsh9tg", "swsh10.5tg": "swsh10tg", "swsh11.5tg": "swsh11tg", "swsh12.5tg": "swsh12tg" };
const prod = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");

let db;
if (prod) {
  const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
  db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
} else {
  db = createClient({ url: "file:data/cardflip.db" });
}

// Rows a person owns: moved to the kept id. The rest are derived (prices, maps) and the kept id has its own.
const MOVE = [["cards", "catalog_card_id"], ["wishlist_items", "card_id"], ["price_checks", "card_id"], ["pending_watches", "card_id"], ["card_photos", "card_id"], ["card_removals", "card_id"]];
const DROP = [["price_series", "card_id"], ["tcgplayer_products", "card_id"], ["listing_lows", "card_id"], ["ebay_asks", "card_id"], ["cardmarket_map", "card_id"], ["en_cards", "id"]];

const tables = new Set((await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => r.name));
const stmts = [];
const saved = [];
for (const [dup, kept] of Object.entries(DUP)) {
  const like = `${dup}-%`;
  for (const [t, col] of [...MOVE, ...DROP]) {
    if (!tables.has(t)) continue;
    const n = Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${t} WHERE ${col} LIKE ?`, args: [like] })).rows[0].n);
    if (!n) continue;
    const move = MOVE.some(([m]) => m === t);
    console.log(`${dup}  ${t}: ${n} ${move ? `-> ${kept}` : "deleted"}`);
    if (move) {
      // OR IGNORE: a person who already has the kept copy keeps that row; the leftover duplicate is dropped below.
      stmts.push({ sql: `UPDATE ${t === "cards" ? "" : "OR IGNORE "}${t} SET ${col} = ? || substr(${col}, ?) WHERE ${col} LIKE ?`, args: [kept, dup.length + 1, like] });
    }
    // A customer's card is only ever moved, never deleted (a failed move stops the whole batch).
    if (t !== "cards") stmts.push({ sql: `DELETE FROM ${t} WHERE ${col} LIKE ?`, args: [like] });
    saved.push({ table: t, rows: (await db.execute({ sql: `SELECT * FROM ${t} WHERE ${col} LIKE ?`, args: [like] })).rows });
  }
}
// Saved search answers (card_cache) hold whole card lists; a row naming a ".5" copy is dropped and rebuilt on the next search.
if (tables.has("card_cache")) {
  const n = Number((await db.execute("SELECT COUNT(*) AS n FROM card_cache WHERE payload LIKE '%.5tg-%'")).rows[0].n);
  if (n) {
    console.log(`card_cache: ${n} saved searches cleared`);
    stmts.push("DELETE FROM card_cache WHERE payload LIKE '%.5tg-%'");
  }
}
console.log(`${prod ? "PROD" : "local"}: ${stmts.length} statements${apply ? "" : " (dry run, add --apply)"}`);
if (apply && stmts.length) {
  const out = `backups/dup-tg-sets-${prod ? "prod" : "local"}-${Date.now()}.json`;
  fs.writeFileSync(out, JSON.stringify(saved));
  console.log(`saved the touched rows to ${out}`);
  await db.batch(stmts, "write");
  console.log("done");
}
