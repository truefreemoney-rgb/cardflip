// (c) 10-31: the German Advent Calendar Yu-Gi-Oh! rows (AC11/AC14 "-DE" numbers). Prod SELECT only.
// Run: node scripts/_ygo-advent-look.mjs
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^ï»¿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const rows = await q(
  `SELECT id, name, set_code, collector_number, price_usd, price_usd_foil FROM tcg_cards
   WHERE game='yugioh' AND (set_code IN ('AC11','AC14','AC18','AC19','TFK') OR name LIKE '%(German)%' OR collector_number LIKE '%-DE%')
   ORDER BY set_code, collector_number`,
);
const by = new Map();
for (const r of rows) {
  const k = `${r.set_code} ${String(r.collector_number).replace(/\d+$/, "")} german=${/\(German\)/.test(r.name)}`;
  by.set(k, (by.get(k) ?? 0) + 1);
}
for (const [k, v] of by) console.log(k, v);
const german = rows.filter((r) => /-DE\d/.test(String(r.collector_number)) || /\(German\)/.test(r.name));
console.log("german rows:", german.length, "priced:", german.filter((r) => r.price_usd != null || r.price_usd_foil != null).length);
console.log("ids:", german.map((r) => r.id).join(","));
console.log("cards cols:", (await q(`PRAGMA table_info(cards)`)).map((r) => r.name).join(", "));
db.close();
