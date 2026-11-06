import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log(JSON.stringify((await db.execute("SELECT * FROM tcgplayer_products WHERE card_id = 'bw5-63' AND game='pokemon'")).rows));