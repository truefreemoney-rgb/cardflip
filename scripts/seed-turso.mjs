// Replay the local SQLite database into a Turso database, schema and all.
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/seed-turso.mjs [--wipe]
//
// Reads data/cardflip.db with the sync driver, recreates every table/index
// from sqlite_master, then streams the rows up as multi-row INSERTs bundled
// into HTTP batches (~2,000 rows per round-trip). Used to seed the staging
// database during the Fly -> Vercel migration; the cutover run re-seeds from
// the production volume's file the same way (copy it local first, --wipe).
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN");
  process.exit(1);
}
const wipe = process.argv.includes("--wipe");

const DB_PATH = process.env.SEED_SOURCE ?? path.join(process.cwd(), "data", "cardflip.db");
const local = new DatabaseSync(DB_PATH, { readOnly: true });
const remote = createClient({ url, authToken });

const ROWS_PER_STMT = 200;
const STMTS_PER_BATCH = 10;

const tables = local
  .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL")
  .all();
const indexes = local
  .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
  .all();

console.log(`source: ${DB_PATH}`);
console.log(`target: ${url}`);
console.log(`${tables.length} tables, ${indexes.length} indexes`);

if (wipe) {
  for (const t of tables) {
    await remote.execute(`DROP TABLE IF EXISTS ${t.name}`);
  }
  console.log("wiped existing tables");
}

for (const t of tables) {
  await remote.execute(t.sql.replace(/^CREATE TABLE/i, "CREATE TABLE IF NOT EXISTS"));
}

let grandTotal = 0;
const t0 = Date.now();
for (const t of tables) {
  const cols = local.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name);
  const total = local.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get().n;
  if (total === 0) {
    console.log(`${t.name}: empty`);
    continue;
  }
  const already = (await remote.execute(`SELECT COUNT(*) AS n FROM ${t.name}`)).rows[0].n;
  if (Number(already) >= total) {
    console.log(`${t.name}: already has ${already} rows, skipping (use --wipe for a clean run)`);
    grandTotal += total;
    continue;
  }

  const colList = cols.join(", ");
  const oneRow = `(${cols.map(() => "?").join(", ")})`;
  const read = local.prepare(`SELECT ${colList} FROM ${t.name}`);
  let stmts = [];
  let rows = [];
  let sent = 0;
  const flushStmt = () => {
    if (rows.length === 0) return;
    stmts.push({
      sql: `INSERT OR REPLACE INTO ${t.name} (${colList}) VALUES ${rows.map(() => oneRow).join(", ")}`,
      args: rows.flat(),
    });
    sent += rows.length;
    rows = [];
  };
  const flushBatch = async () => {
    flushStmt();
    if (stmts.length === 0) return;
    await remote.batch(stmts, "write");
    stmts = [];
    process.stdout.write(`\r${t.name}: ${sent}/${total}`);
  };
  for (const row of read.iterate()) {
    rows.push(cols.map((c) => row[c] ?? null));
    if (rows.length >= ROWS_PER_STMT) flushStmt();
    if (stmts.length >= STMTS_PER_BATCH) await flushBatch();
  }
  await flushBatch();
  grandTotal += total;
  process.stdout.write(`\r${t.name}: ${sent}/${total} done\n`);
}

for (const i of indexes) {
  try {
    await remote.execute(i.sql.replace(/^CREATE (UNIQUE )?INDEX/i, "CREATE $1INDEX IF NOT EXISTS"));
  } catch (err) {
    console.warn(`index ${i.name}: ${err.message}`);
  }
}

console.log(`\nseeded ${grandTotal} rows in ${Math.round((Date.now() - t0) / 1000)}s`);
remote.close();
local.close();
