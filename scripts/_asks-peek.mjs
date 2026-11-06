import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log(JSON.stringify((await db.execute("SELECT card_id, variant, price_usd, median_usd, n_nm, verdict, manual, manual_price, day FROM ebay_asks WHERE card_id='pl3-5'")).rows));
console.log(JSON.stringify((await db.execute("SELECT game, COUNT(*) n FROM tcgplayer_products GROUP BY game")).rows));