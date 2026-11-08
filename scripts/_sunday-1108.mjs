import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log("promo:", JSON.stringify((await db.execute("SELECT code, COUNT(*) n FROM promo_redemptions WHERE code IN ('SUNDAY25','FLIPBACK') GROUP BY code")).rows));
const ref = JSON.parse(String((await db.execute("SELECT value FROM price_history_meta WHERE key = 'ebay_referee_last'")).rows[0].value));
const { sellerFloor, ...r2 } = ref; console.log("referee:", JSON.stringify(r2).slice(0, 300));
