// Replay our picture columns (own_image_url / own_tile_url / own_image_src) from
// the local DB to Turso where prod differs (10-12). save-pictures.mjs --prod
// writes Turso in batches of 200; a run cut short by the Scryfall guard
// (process.exit) or a crash leaves the last batch local-only. Idempotent.
//
//   node scripts/push-own-pictures.mjs --game mtg|pokemon|lorcana|onepiece|yugioh [--dry]
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const game = args[args.indexOf("--game") + 1] ?? "";
const dry = args.includes("--dry");
const T = { mtg: ["mtg_cards", "1 = 1", []], pokemon: ["en_cards", "1 = 1", []] }[game] ?? ["tcg_cards", "game = ?", [game]];
if (!/^(lorcana|onepiece|yugioh|pokemon|mtg)$/.test(game)) {
  console.error("usage: --game lorcana|onepiece|yugioh|pokemon|mtg [--dry]");
  process.exit(2);
}
const [table, where, params] = T;
const db = new DatabaseSync(process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db"), { readOnly: true });
const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
const prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });

const local = db.prepare(`SELECT id, own_image_url, own_tile_url, own_image_src FROM ${table} WHERE ${where} AND own_image_url <> ''`).all(...params);
const remote = new Map();
const pr = await prod.execute({ sql: `SELECT id, own_image_url FROM ${table} WHERE ${where} AND own_image_url <> ''`, args: params });
for (const r of pr.rows) remote.set(r.id, r.own_image_url);
const todo = local.filter((r) => remote.get(r.id) !== r.own_image_url);
console.log(`${game}: local ${local.length} saved, prod ${remote.size}; ${todo.length} to push${dry ? " (dry)" : ""}`);
if (!dry) {
  const sql = `UPDATE ${table} SET own_image_url = ?, own_tile_url = ?, own_image_src = ? WHERE id = ?`;
  for (let i = 0; i < todo.length; i += 200) {
    await prod.batch(todo.slice(i, i + 200).map((r) => ({ sql, args: [r.own_image_url, r.own_tile_url, r.own_image_src, r.id] })), "write");
  }
  console.log(`pushed ${todo.length}`);
}
