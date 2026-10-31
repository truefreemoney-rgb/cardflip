// (c) 10-31, Chris "c. yes": remove the 48 German Advent Calendar Yu-Gi-Oh! rows (AC11/AC14 "-DE") from prod + local.
// English-only catalog; sync-yugioh.mjs now skips them so they never come back.
// Dry run by default; --apply writes. Backup of every touched row -> data/ygo-german-removed-2026-10-31.json first.
//   node scripts/_ygo-german-remove.mjs [--apply]
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";
const apply = process.argv.includes("--apply");
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^ï»¿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const WHERE = `game='yugioh' AND set_code IN ('AC11','AC14') AND collector_number LIKE '%-DE%'`;
const rows = await q(`SELECT * FROM tcg_cards WHERE ${WHERE}`);
const ids = rows.map((r) => r.id);
console.log(`tcg_cards German Advent rows: ${ids.length}`);
if (ids.length !== 48) throw new Error(`expected 48, got ${ids.length}: stop`);
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

const backup = path.join("data", "ygo-german-removed-2026-10-31.json");
fs.writeFileSync(backup, JSON.stringify({ tcg_cards: rows, linked }, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 1));
console.log(`backup -> ${backup}`);
if (!apply) {
  console.log("dry run: nothing written (add --apply)");
  db.close();
  process.exit(0);
}
const stmts = Object.entries(linked).map(([t, v]) => ({ sql: `DELETE FROM ${t} WHERE ${v.col} IN (${ph})`, args: ids }));
stmts.push({ sql: `DELETE FROM tcg_cards WHERE ${WHERE}`, args: [] });
const res = await db.batch(stmts, "write");
res.forEach((r, i) => console.log(`prod: ${stmts[i].sql.slice(0, 40)}... -> ${r.rowsAffected}`));
db.close();

const local = new DatabaseSync(path.join(process.cwd(), "data", "cardflip.db"));
const localTables = new Set(local.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name));
for (const [t, v] of Object.entries(linked)) {
  if (localTables.has(t)) console.log(`local ${t}: ${local.prepare(`DELETE FROM ${t} WHERE ${v.col} IN (${ph})`).run(...ids).changes}`);
}
console.log(`local tcg_cards: ${local.prepare(`DELETE FROM tcg_cards WHERE ${WHERE}`).run().changes}`);
local.close();
