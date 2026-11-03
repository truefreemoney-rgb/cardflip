import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = await db.execute("UPDATE ebay_asks SET manual = 'keep', manual_price = 992.2, manual_day = '2026-11-03' WHERE game = 'pokemon' AND card_id = 'ex3-90' AND variant = 'holofoil'");
console.log("keep rows:", r.rowsAffected);
for (const x of (await db.execute("SELECT card_id, variant, usd, n, day FROM price_checked WHERE card_id = 'ex3-90'")).rows) console.log(JSON.stringify(x));
for (const x of (await db.execute("SELECT card_id, price_usd, verdict, manual, manual_price FROM ebay_asks WHERE card_id = 'ex3-90'")).rows) console.log(JSON.stringify(x));
