import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
console.log((await db.execute("PRAGMA table_info(ebay_asks)")).rows.map(r => r.name).join(","));
for (const [id, v, old] of [["xyp-XY03","holofoil",26.08],["pl3-56","normal",32.88],["col1-91","holofoil",160.12],["bw5-63","holofoil",29.63]]) {
  const cm = (await db.execute({ sql: "SELECT prices, updated_day FROM price_series WHERE card_id=? AND source='cardmarket' AND variant='average'", args: [id] })).rows[0];
  const cmLast = cm ? JSON.parse(cm.prices).filter(x => x != null).slice(-1)[0] : null;
  const a = (await db.execute({ sql: "SELECT * FROM ebay_asks WHERE card_id=?", args: [id] })).rows;
  console.log(id, v, "old", old, "cm", cmLast, "ratio", cmLast ? (old / (cmLast * 1.1)).toFixed(2) : "-", "| asks", JSON.stringify(a).slice(0, 300));
}