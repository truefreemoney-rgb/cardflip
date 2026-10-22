// READ ONLY: how many TCGplayer USD prices have not moved in 30+ days, by game and by value (Chris 10-21: "how will we
// ever tackle that many cards"). "Flat N days" = the last N priced points carry the identical value; "last priced" =
// days since the series last had any point at all.
// Run: node scripts/_stale-count.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const DAY = 86_400_000;
const today = Math.floor(Date.now() / DAY);
const dayNum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
const bucket = (p) => (p < 1 ? "<$1" : p < 10 ? "$1-9" : p < 100 ? "$10-99" : p < 500 ? "$100-499" : "$500+");
const BUCKETS = ["<$1", "$1-9", "$10-99", "$100-499", "$500+"];
const tally = {};
const add = (game, b, k) => ((tally[game] ??= {}), (tally[game][b] ??= { rows: 0, flat30: 0, flat90: 0, unpriced30: 0 }), tally[game][b][k]++);
let offset = 0;
const PAGE = 20000;
for (;;) {
  const rows = (await c.execute({ sql: "SELECT game, start_day, prices FROM price_series WHERE source='tcgplayer' AND currency='USD' LIMIT ? OFFSET ?", args: [PAGE, offset] })).rows;
  if (rows.length === 0) break;
  offset += rows.length;
  for (const r of rows) {
    let prices;
    try { prices = JSON.parse(r.prices); } catch { continue; }
    let last = -1;
    for (let i = prices.length - 1; i >= 0; i--) if (prices[i] != null) { last = i; break; }
    if (last < 0) continue;
    const p = prices[last];
    const b = bucket(p);
    add(r.game, b, "rows");
    const lastDay = dayNum(r.start_day) + last;
    if (today - lastDay >= 30) add(r.game, b, "unpriced30");
    // flat run: walk back over priced points while identical
    let first = last;
    for (let i = last - 1; i >= 0; i--) { if (prices[i] == null) continue; if (prices[i] !== p) break; first = i; }
    const flatDays = today - (dayNum(r.start_day) + first);
    if (flatDays >= 30) add(r.game, b, "flat30");
    if (flatDays >= 90) add(r.game, b, "flat90");
  }
  process.stderr.write(`${offset}\r`);
}
console.log("game | value | rows | flat 30+ days | flat 90+ days | no point in 30+ days");
const tot = {};
for (const g of Object.keys(tally).sort()) for (const b of BUCKETS) {
  const t = tally[g][b]; if (!t) continue;
  console.log(`${g} | ${b} | ${t.rows} | ${t.flat30} | ${t.flat90} | ${t.unpriced30}`);
  for (const k of Object.keys(t)) tot[k] = (tot[k] ?? 0) + t[k];
}
console.log("ALL |", JSON.stringify(tot));
