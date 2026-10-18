import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log((await c.execute("PRAGMA table_info(ebay_asks)")).rows.map((r) => r.name).join(","));
const r = await c.execute("SELECT COUNT(*) n, COUNT(DISTINCT card_id) cards, MIN(day) mn, MAX(day) mx FROM ebay_asks"); const v = await c.execute("SELECT verdict, COUNT(*) n FROM ebay_asks WHERE day >= date('now','-7 day') GROUP BY verdict"); console.log(JSON.stringify(v.rows)); const m = await c.execute("SELECT manual, COUNT(*) n FROM ebay_asks WHERE manual IS NOT NULL GROUP BY manual"); console.log("manual", JSON.stringify(m.rows));
console.log(JSON.stringify(r.rows[0]));
