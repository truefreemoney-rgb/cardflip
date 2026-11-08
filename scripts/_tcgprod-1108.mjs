import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const ids = ["dp7-3","gym1-63-1st","base1-31-1st","ex6-15","exu-O"];
for (const id of ids) console.log(id, JSON.stringify((await db.execute({ sql: "SELECT * FROM tcgplayer_products WHERE card_id = ?", args: [id] })).rows).slice(0, 400));
for (const id of ["5cdcc324-1427-453c-9940-c21f5d04c997","e4dbd98c-5d78-4a15-995e-6baee2116f5d"]) {
  const t = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%mtg%'")).rows.map(r=>r.name);
  console.log(id, t.join(","));
}
