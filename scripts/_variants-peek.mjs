// Read-only: prod price_series rows for card ids (any game); `--like pattern` lists matching ids.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const args = process.argv.slice(2);
const like = args.indexOf("--like");
if (like >= 0) {
  const r = await c.execute({ sql: "SELECT game, card_id, variant, source, updated_day, substr(prices, -50) p FROM price_series WHERE card_id LIKE ? LIMIT 20", args: [args[like + 1]] });
  for (const row of r.rows) console.log(JSON.stringify(row));
} else {
  for (const id of args) {
    const r = await c.execute({ sql: "SELECT game, card_id, variant, source, currency, start_day, updated_day, substr(prices, -90) p FROM price_series WHERE card_id = ?", args: [id] });
    for (const row of r.rows) console.log(JSON.stringify(row));
  }
}
