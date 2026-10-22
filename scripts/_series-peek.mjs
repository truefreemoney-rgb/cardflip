// Read-only: a card's price_series tails + checks. node scripts/_series-peek.mjs <game> <cardId>
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const [game, cardId] = process.argv.slice(2);
const r = await c.execute({ sql: "SELECT variant, source, currency, start_day, updated_day, prices FROM price_series WHERE game = ? AND card_id = ?", args: [game, cardId] });
for (const row of r.rows) {
  const p = JSON.parse(row.prices);
  console.log(row.variant, row.source, row.currency, "start", row.start_day, "updated", row.updated_day, "n", p.length, "tail", JSON.stringify(p.slice(-14)));
}
const k = await c.execute({ sql: "SELECT * FROM price_checked WHERE game = ? AND card_id = ?", args: [game, cardId] });
console.log("checks", JSON.stringify(k.rows));
const m = await c.execute({ sql: "SELECT * FROM tcgplayer_products WHERE game = ? AND card_id = ?", args: [game, cardId] });
console.log("tcgplayer_products", JSON.stringify(m.rows));
