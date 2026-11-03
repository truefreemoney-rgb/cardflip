import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = await db.execute("SELECT author, at, text, draft FROM social_comments WHERE status = 'new' AND at >= '2026-10-21' ORDER BY at");
for (const x of r.rows) console.log(String(x.at).slice(0, 16), String(x.author).slice(0, 28), "::", String(x.text).replace(/\s+/g, " "), x.draft ? " [draft: " + x.draft + "]" : "");
const ea = await db.execute("SELECT card_id, price_usd, verdict, reason, manual, manual_price FROM ebay_asks WHERE game='pokemon' AND card_id IN ('sm9-184','ex3-90')");
for (const x of ea.rows) console.log(JSON.stringify(x));
