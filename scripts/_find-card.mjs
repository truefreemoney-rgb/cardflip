// READ ONLY (prod): catalog rows (tcg_cards) whose collector number or name matches, to get a card id for _series-peek.
//   node scripts/_find-card.mjs <number-or-name> [game]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const [q, game] = process.argv.slice(2);
const rows = (
  await c.execute({
    sql: `SELECT game, id, name, set_name, collector_number, variant, price_usd FROM tcg_cards
           WHERE (collector_number = ? OR name LIKE ?) ${game ? "AND game = ?" : ""} LIMIT 20`,
    args: game ? [q, `%${q}%`, game] : [q, `%${q}%`],
  })
).rows;
for (const r of rows) console.log(JSON.stringify(r));
