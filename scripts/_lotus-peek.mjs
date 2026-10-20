// Read-only: 2ED Black Lotus series + how many Magic Cardmarket series rose ~12% on the last point (the 10-19 lift).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const id = [];
console.log("mtg_cards:", JSON.stringify(id));
for (const row of id) {
  const s = await c.execute({ sql: "SELECT source, variant, currency, start_day, updated_day, prices FROM price_series WHERE card_id = ?", args: [row.id] });
  for (const x of s.rows) { const p = JSON.parse(x.prices); console.log(x.source, x.variant, x.currency, x.start_day, "->", x.updated_day, "last10:", p.slice(-10).join(" ")); }
  const t = await c.execute({ sql: "SELECT * FROM price_trust WHERE card_id = ?", args: [row.id] }).catch(e => ({ rows: [String(e.message).slice(0, 80)] }));
  console.log("trust:", JSON.stringify(t.rows).slice(0, 400));
}
const cm = await c.execute({ sql: "SELECT prices FROM price_series WHERE game = 'mtg' AND source = 'cardmarket-converted' AND updated_day >= '2026-10-20'", args: [] });
let lifted = 0, total = 0;
for (const x of cm.rows) { const p = JSON.parse(x.prices).filter((v) => v != null); if (p.length < 2) continue; total++; const r = p[p.length - 1] / p[p.length - 2]; if (r > 1.10 && r < 1.14) lifted++; }
console.log(`cardmarket mtg series updated 10-20: ${total}, last point 1.10-1.14x the one before: ${lifted}`);
