import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const t of ["tcg_cards", "en_cards", "card_cache"]) console.log(t, (await db.execute(`PRAGMA table_info(${t})`)).rows.map(r => r.name).join(","));
const r = (await db.execute("SELECT * FROM tcg_cards WHERE id LIKE '%sv06-025%' OR id LIKE '%base1-27%' LIMIT 3")).rows; for (const x of r) console.log(JSON.stringify(x).slice(0, 400));