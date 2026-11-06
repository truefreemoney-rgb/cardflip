import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = (await db.execute("SELECT variant, start_day, prices FROM price_series WHERE card_id='bw5-63' AND source='tcgplayer' AND variant='holofoil'")).rows[0];
const p = JSON.parse(r.prices); const s = new Date(r.start_day + "T00:00:00Z");
for (let i = 0; i < p.length; i += 10) console.log(new Date(s.getTime() + i * 864e5).toISOString().slice(0, 10), p[i]);
console.log("last", p[p.length - 1], "len", p.length, "start", r.start_day);