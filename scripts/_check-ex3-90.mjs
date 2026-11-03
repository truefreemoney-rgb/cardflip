import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const x of (await db.execute("SELECT * FROM price_checked WHERE card_id = 'ex3-90'")).rows) console.log(JSON.stringify(x));
