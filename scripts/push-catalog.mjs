// Push the locally-synced catalog mirrors up to the live Turso database.
//
//   node scripts/push-catalog.mjs [--dry]
//
// The catalog syncs (sync:en/jp/zh, sync:mtg, sync:species, backfill:pokemon)
// must run on Chris's PC — Scryfall and the Pokémon sources 429/deny cloud
// egress IPs — and they write the local data/cardflip.db. Production is
// Turso, so without this push a new set never reaches cardflip.io. This is
// the missing third step, wired into the weekly "CardFlip catalog sync"
// Task Scheduler job: sync locally, then replay ONLY the catalog tables
// upstream as INSERT OR REPLACE batches.
//
// Deliberately NOT pushed: price_series (prod's daily job maintains it with
// fresher points than any local copy), and every user-owned table (users,
// cards, sessions, ... — replaying those would clobber production data).
// Catalog rows are upstream-derived and idempotent, so REPLACE is safe.
//
// Credentials like backup-turso.mjs: TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or
// .env.migration.json (dbUrl/dbToken).
import fs from "node:fs";
import path from "node:path";
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
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (or .env.migration.json)");
  process.exit(1);
}
const dry = process.argv.includes("--dry");

const CATALOG_TABLES = [
  "en_cards",
  "jp_cards",
  "zh_cards",
  "species_names",
  "mtg_sets",
  "mtg_cards",
  "tcgplayer_products",
];

const local = new DatabaseSync(path.join(root, "data", "cardflip.db"), { readOnly: true });
const remote = createClient({ url, authToken });

const ROWS_PER_STMT = 200;
const STMTS_PER_BATCH = 10;
const t0 = Date.now();

for (const table of CATALOG_TABLES) {
  const exists = local
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!exists) {
    console.log(`${table}: not in local db — skipped`);
    continue;
  }
  const cols = local.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const localCount = local.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  let remoteCount = 0;
  try {
    remoteCount = Number((await remote.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  } catch {
    console.log(`${table}: missing on Turso — will create rows only if the app's schema made the table; skipping`);
    continue;
  }
  // Catalog syncs only ever add or refresh rows, so equal MAX(synced_at)
  // and count means nothing new — skip the upload. species_names and
  // tcgplayer_products have no synced_at; they compare by count alone.
  const hasSynced = cols.includes("synced_at");
  const localMark = hasSynced ? local.prepare(`SELECT COALESCE(MAX(synced_at),0) AS m FROM ${table}`).get().m : null;
  const remoteMark = hasSynced
    ? Number((await remote.execute(`SELECT COALESCE(MAX(synced_at),0) AS m FROM ${table}`)).rows[0].m)
    : null;
  if (localCount === remoteCount && (!hasSynced || localMark <= remoteMark)) {
    console.log(`${table}: up to date (${localCount} rows)`);
    continue;
  }
  if (localCount === 0) {
    console.log(`${table}: local empty but remote has ${remoteCount} — NOT pushing (would do nothing, flags a stale local sync)`);
    continue;
  }
  console.log(`${table}: pushing ${localCount} rows (remote has ${remoteCount})${dry ? " [dry run]" : ""}`);
  if (dry) continue;

  const colList = cols.join(", ");
  const rows = local.prepare(`SELECT ${colList} FROM ${table}`).all();
  let stmts = [];
  let pushed = 0;
  const flush = async () => {
    if (stmts.length === 0) return;
    await remote.batch(stmts, "write");
    stmts = [];
  };
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT) {
    const chunk = rows.slice(i, i + ROWS_PER_STMT);
    const placeholders = chunk.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ");
    const args = chunk.flatMap((r) => cols.map((c) => r[c] ?? null));
    stmts.push({ sql: `INSERT OR REPLACE INTO ${table} (${colList}) VALUES ${placeholders}`, args });
    pushed += chunk.length;
    if (stmts.length >= STMTS_PER_BATCH) await flush();
  }
  await flush();
  const after = Number((await remote.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  console.log(`${table}: done — remote now ${after} rows`);
  if (after < localCount) {
    console.error(`${table}: remote count ${after} < local ${localCount} after push`);
    process.exitCode = 1;
  }
}

console.log(`catalog push finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
