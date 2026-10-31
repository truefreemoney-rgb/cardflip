// 10-31, Chris "yes remove the spanish ones too": Yu-Gi-Oh! Spanish printings ("-SP" numbers / "(Spanish)" names) off prod + local.
// Dry run by default; --apply writes. Backup -> data/ygo-spanish-removed-2026-10-31.json first.
//   node scripts/_ygo-spanish-remove.mjs [--apply]
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";
const apply = process.argv.includes("--apply");
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^ï»¿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const all = await q(`SELECT * FROM tcg_cards WHERE game='yugioh' AND (collector_number LIKE '%-SP%' OR name LIKE '%(Spanish)%')`);
const rows = all.filter((r) => /-SP\d/.test(String(r.collector_number)) || /\(Spanish\)/i.test(String(r.name)));
for (const r of rows) console.log(`  ${r.id} | ${r.name} | ${r.set_code} ${r.collector_number} | $${r.price_usd ?? "-"}`);
const ids = rows.map((r) => r.id);
console.log(`Spanish rows: ${ids.length}`);
if (ids.length === 0 || ids.length > 5) throw new Error(`expected the 2 TFK-SP rows, got ${ids.length}: stop`);
const ph = ids.map(() => "?").join(",");
const owned = (await q(`SELECT COUNT(*) n FROM cards WHERE catalog_card_id IN (${ph})`, ids))[0].n;
console.log(`user cards on them: ${owned}`);
if (Number(owned) > 0) throw new Error("a user owns one: stop, ask Chris");

const linked = {};
for (const t of (await q(`SELECT name FROM sqlite_master WHERE type='table'`)).map((r) => r.name)) {
  const col = (await q(`PRAGMA table_info(${t})`)).map((r) => r.name).find((c) => c === "card_id" || c === "tcg_card_id");
  if (!col) continue;
  const hit = await q(`SELECT * FROM ${t} WHERE ${col} IN (${ph})`, ids);
  if (hit.length) linked[t] = { col, rows: hit };
}
for (const [t, v] of Object.entries(linked)) console.log(`  ${t}.${v.col}: ${v.rows.length}`);
const backup = path.join("data", "ygo-spanish-removed-2026-10-31.json");
fs.writeFileSync(backup, JSON.stringify({ tcg_cards: rows, linked }, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 1));
console.log(`backup -> ${backup}`);
if (!apply) {
  console.log("dry run: nothing written (add --apply)");
  db.close();
  process.exit(0);
}
const stmts = Object.entries(linked).map(([t, v]) => ({ sql: `DELETE FROM ${t} WHERE ${v.col} IN (${ph})`, args: ids }));
stmts.push({ sql: `DELETE FROM tcg_cards WHERE id IN (${ph})`, args: ids });
const res = await db.batch(stmts, "write");
res.forEach((r, i) => console.log(`prod: ${stmts[i].sql.slice(0, 40)}... -> ${r.rowsAffected}`));
db.close();
const local = new DatabaseSync(path.join(process.cwd(), "data", "cardflip.db"));
const localTables = new Set(local.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name));
for (const [t, v] of Object.entries(linked)) {
  if (localTables.has(t)) console.log(`local ${t}: ${local.prepare(`DELETE FROM ${t} WHERE ${v.col} IN (${ph})`).run(...ids).changes}`);
}
console.log(`local tcg_cards: ${local.prepare(`DELETE FROM tcg_cards WHERE id IN (${ph})`).run(...ids).changes}`);
local.close();
