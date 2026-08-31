// Pull the live Turso database down into a local gzipped SQLite file.
//
//   node scripts/backup-turso.mjs [--keep N]
//
// The reverse of seed-turso.mjs: reads every table/index from the remote
// sqlite_master, recreates them in a fresh local file (node:sqlite, sync
// writes), streams the rows down with rowid pagination (OFFSET fallback for
// WITHOUT ROWID tables), verifies per-table counts + PRAGMA integrity_check,
// then gzips to backups/turso/cardflip-<yyyy-mm-dd>.db.gz and prunes old
// copies (default keep 10). Credentials come from .env.migration.json
// (dbUrl/dbToken) or TURSO_DATABASE_URL/TURSO_AUTH_TOKEN.
//
// This exists because the in-app backup (lib/server/backup.ts) is a no-op on
// Turso — VACUUM INTO needs a local file — and the old Turso ACCOUNT was lost
// outright in Aug 2026, which point-in-time restore does not survive. An
// off-Turso copy is the disaster story now. Restore = seed-turso.mjs --wipe
// with SEED_SOURCE pointed at a gunzipped copy of one of these files.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";

const root = process.cwd();
let url = process.env.TURSO_DATABASE_URL;
let authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  const credPath = path.join(root, ".env.migration.json");
  if (fs.existsSync(credPath)) {
    const cfg = JSON.parse(fs.readFileSync(credPath, "utf8").replace(/^﻿/, ""));
    url = url || cfg.dbUrl;
    authToken = authToken || cfg.dbToken;
  }
}
if (!url || !authToken) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (or provide .env.migration.json)");
  process.exit(1);
}

const keepArg = process.argv.indexOf("--keep");
const KEEP = keepArg >= 0 ? Math.max(1, Number(process.argv[keepArg + 1]) || 10) : 10;
const PAGE = 2000;

const day = new Date().toISOString().slice(0, 10);
const outDir = path.join(root, "backups", "turso");
fs.mkdirSync(outDir, { recursive: true });
const raw = path.join(outDir, `cardflip-${day}.db`);
const gz = `${raw}.gz`;
fs.rmSync(raw, { force: true });

const remote = createClient({ url, authToken });
const local = new DatabaseSync(raw);
local.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");

// Values arrive as string/number/bigint/ArrayBuffer/null; node:sqlite wants
// Uint8Array for blobs and chokes on out-of-range bigints.
const coerce = (v) => {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === "bigint") return v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER ? Number(v) : v;
  return v;
};

const master = await remote.execute(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
);
const tables = master.rows.filter((r) => r.type === "table");
const rest = master.rows.filter((r) => r.type !== "table");
console.log(`source: ${url}`);
console.log(`target: ${raw}`);
console.log(`${tables.length} tables, ${rest.length} indexes/triggers`);

const t0 = Date.now();
let grandTotal = 0;
const problems = [];
for (const t of tables) {
  local.exec(t.sql);
  const total = Number((await remote.execute(`SELECT COUNT(*) AS n FROM ${t.name}`)).rows[0].n);
  if (total === 0) {
    console.log(`${t.name}: empty`);
    continue;
  }
  let insert = null;
  let copied = 0;
  const writePage = (rows, cols) => {
    if (!insert) {
      insert = local.prepare(`INSERT INTO ${t.name} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
    }
    local.exec("BEGIN");
    for (const row of rows) insert.run(...cols.map((c) => coerce(row[c])));
    local.exec("COMMIT");
    copied += rows.length;
    process.stdout.write(`\r${t.name}: ${copied}/${total}`);
  };
  try {
    let last = null;
    for (;;) {
      const page = await remote.execute({
        sql: `SELECT rowid AS __rid, * FROM ${t.name}${last === null ? "" : " WHERE rowid > ?"} ORDER BY rowid LIMIT ${PAGE}`,
        args: last === null ? [] : [last],
      });
      if (page.rows.length === 0) break;
      const cols = page.columns.filter((c) => c !== "__rid");
      writePage(page.rows, cols);
      last = page.rows[page.rows.length - 1].__rid;
      if (page.rows.length < PAGE) break;
    }
  } catch (err) {
    // WITHOUT ROWID (or rowid shadowed) — fall back to plain OFFSET pages.
    console.warn(`\n${t.name}: rowid pagination failed (${err.message}), using OFFSET`);
    for (let off = copied; ; off += PAGE) {
      const page = await remote.execute(`SELECT * FROM ${t.name} LIMIT ${PAGE} OFFSET ${off}`);
      if (page.rows.length === 0) break;
      writePage(page.rows, page.columns);
      if (page.rows.length < PAGE) break;
    }
  }
  const localCount = local.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get().n;
  const ok = Number(localCount) === total;
  if (!ok) problems.push(`${t.name}: remote ${total} vs local ${localCount}`);
  process.stdout.write(`\r${t.name}: ${localCount}/${total}${ok ? " ok" : " MISMATCH"}\n`);
  grandTotal += total;
}
for (const r of rest) {
  try {
    local.exec(r.sql);
  } catch (err) {
    console.warn(`${r.type} ${r.name}: ${err.message}`);
  }
}
remote.close();

const integrity = local.prepare("PRAGMA integrity_check").get();
local.close();
const integrityOk = String(Object.values(integrity)[0]) === "ok";
if (!integrityOk) problems.push(`integrity_check: ${JSON.stringify(integrity)}`);

fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(raw), { level: 6 }));
fs.rmSync(raw, { force: true });

const old = fs
  .readdirSync(outDir)
  .filter((f) => /^cardflip-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(f))
  .sort()
  .slice(0, -KEEP);
for (const f of old) fs.rmSync(path.join(outDir, f));

const mb = (fs.statSync(gz).size / 1024 / 1024).toFixed(1);
console.log(`\n${grandTotal} rows -> ${path.relative(root, gz)} (${mb} MB gzipped) in ${Math.round((Date.now() - t0) / 1000)}s`);
if (old.length) console.log(`pruned ${old.length} old backup(s), keeping ${KEEP}`);
if (problems.length) {
  console.error("PROBLEMS:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("integrity_check ok, all table counts match");
