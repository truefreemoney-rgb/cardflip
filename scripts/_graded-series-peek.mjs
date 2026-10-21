// Read-only: price_series rows whose variant is a graded slab ("graded-psa-10"), which the raw printing lists must never show.
// node scripts/_graded-series-peek.mjs [--prod]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const prod = process.argv.includes("--prod");
const c = prod
  ? (() => { const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿|^ï»¿/, "")); return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken }); })()
  : createClient({ url: "file:data/cardflip.db" });
const r = await c.execute("SELECT card_id, game, variant, source, currency, updated_day, prices FROM price_series WHERE variant LIKE 'graded-%' ORDER BY updated_day DESC");
console.log(`${r.rows.length} graded series rows`);
for (const row of r.rows.slice(0, 40)) {
  const p = JSON.parse(String(row.prices));
  const last = [...p].reverse().find((v) => v != null);
  console.log(row.card_id, row.game, row.variant, row.source, row.currency, "upd", row.updated_day, "last", last);
}
