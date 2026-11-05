import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const v = JSON.parse(String((await db.execute("SELECT value FROM price_history_meta WHERE key = 'ebay_referee_last'")).rows[0].value));
const { sellerFloor, ...rest } = v; console.log(JSON.stringify(rest).slice(0, 600));
const h = (await db.execute("SELECT * FROM price_history WHERE card_id = 'xyp-XY96' ORDER BY day DESC LIMIT 8")).rows;
for (const r of h) console.log(JSON.stringify(r).slice(0, 220));