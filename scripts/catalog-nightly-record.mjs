// Records the nightly catalog run (scripts/catalog-sync.cmd) in Turso:
// price_history_meta "catalog_nightly" = { at, failed: [steps], games: { <game>: { cards, noOwnPicture, standIns } },
//   borrowing: [{ game, name, set, released }] } (up to 40 cards still showing another printing 14+ days after release).
// /admin reads it so a dead PC run or a failing step shows up without opening a log.
//   node scripts/catalog-nightly-record.mjs [failed-step ...]
import fs from "node:fs";
import { createClient } from "@libsql/client";

const creds = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: creds.dbUrl, authToken: creds.dbToken });
const one = async (sql, args = []) => Number((await c.execute({ sql, args })).rows[0]?.n ?? 0);
const games = {};
const borrowing = [];
const BORROWING = "(own_image_src LIKE 'standin:%' OR (own_image_url <> '' AND image_url <> '' AND own_image_src <> image_url))";
const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
const count = async (game, table, where = "1", args = []) => {
  games[game] = {
    cards: await one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, args),
    noOwnPicture: await one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} AND COALESCE(own_image_url, '') = ''`, args),
    // Borrowing = a new card's stand-in (own_image_src "standin:<id>") or an older card whose saved copy is not of its own link (10-13: the old dead-list stand-ins); save-pictures.mjs retries both nightly.
    standIns: await one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} AND ${BORROWING}`, args),
  };
  const old = await c.execute({
    sql: `SELECT name, set_name AS "set", set_release_date AS released FROM ${table} WHERE ${where} AND ${BORROWING} AND set_release_date <> '' AND set_release_date <= ? ORDER BY set_release_date LIMIT 40`,
    args: [...args, cutoff],
  });
  for (const r of old.rows) borrowing.push({ game, name: String(r.name), set: String(r.set ?? ""), released: String(r.released ?? "").slice(0, 10) });
};
await count("pokemon", "en_cards");
await count("mtg", "mtg_cards");
for (const g of ["yugioh", "onepiece", "lorcana"]) await count(g, "tcg_cards", "game = ?", [g]);
const record = { at: Date.now(), failed: process.argv.slice(2).filter(Boolean), games, borrowing: borrowing.slice(0, 40) };
await c.execute({ sql: "INSERT OR REPLACE INTO price_history_meta (key, value) VALUES ('catalog_nightly', ?)", args: [JSON.stringify(record)] });
console.log("catalog_nightly:", JSON.stringify(record));
