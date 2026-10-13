// Records the nightly catalog run (scripts/catalog-sync.cmd) in Turso:
// price_history_meta "catalog_nightly" = { at, failed: [steps], games: { <game>: { cards, noOwnPicture } } }.
// /admin reads it so a dead PC run or a failing step shows up without opening a log.
//   node scripts/catalog-nightly-record.mjs [failed-step ...]
import fs from "node:fs";
import { createClient } from "@libsql/client";

const creds = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: creds.dbUrl, authToken: creds.dbToken });
const one = async (sql, args = []) => Number((await c.execute({ sql, args })).rows[0]?.n ?? 0);
const games = {};
const count = async (game, table, where = "1", args = []) => {
  games[game] = {
    cards: await one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, args),
    noOwnPicture: await one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} AND COALESCE(own_image_url, '') = ''`, args),
  };
};
await count("pokemon", "en_cards");
await count("mtg", "mtg_cards");
for (const g of ["yugioh", "onepiece", "lorcana"]) await count(g, "tcg_cards", "game = ?", [g]);
const record = { at: Date.now(), failed: process.argv.slice(2).filter(Boolean), games };
await c.execute({ sql: "INSERT OR REPLACE INTO price_history_meta (key, value) VALUES ('catalog_nightly', ?)", args: [JSON.stringify(record)] });
console.log("catalog_nightly:", JSON.stringify(record));
