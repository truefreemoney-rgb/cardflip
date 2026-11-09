// Read-only: how many Magic tcgplayer USD series stepped each day, by size and shape.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await db.execute("SELECT card_id, variant, start_day, prices FROM price_series WHERE game='mtg' AND source='tcgplayer' AND currency='USD'")).rows;
console.log("series", rows.length);
const dayOf = (s, i) => new Date(Date.parse(s + "T00:00:00Z") + i * 864e5).toISOString().slice(5, 10);
const by = new Map();
for (const r of rows) {
  const p = JSON.parse(r.prices);
  for (let i = Math.max(1, p.length - 24); i < p.length; i++) {
    const a = p[i - 1], b = p[i]; if (a == null || b == null || a < 5 || b < 5 || a === b) continue;
    const d = dayOf(r.start_day, i); const x = by.get(d) ?? { up25: 0, down25: 0, up10: 0, down10: 0, any: 0, to10: 0 };
    x.any++; const q = b / a;
    if (q >= 1.25) x.up25++; else if (q >= 1.1) x.up10++;
    if (q <= 0.8) x.down25++; else if (q <= 0.9) x.down10++;
    if (b === 10) x.to10++;
    by.set(d, x);
  }
}
for (const [d, x] of [...by].sort()) console.log(d, JSON.stringify(x));
