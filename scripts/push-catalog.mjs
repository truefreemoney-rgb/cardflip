// Push the locally-synced catalog mirrors up to the live Turso database.
//
//   node scripts/push-catalog.mjs [--dry]
//
// The catalog syncs (sync:en/jp/zh, sync:mtg, sync:species, backfill:pokemon)
// must run on Chris's PC — Scryfall and the Pokémon sources 429/deny cloud
// egress IPs — and they write the local data/cardflip.db. Production is
// Turso, so without this push a new set never reaches cardflip.io. This is
// the missing third step, wired into the nightly "CardFlip catalog sync"
// Task Scheduler job: sync locally, then replay ONLY the catalog tables
// upstream as INSERT OR REPLACE batches, and only the rows whose content
// changed since the last push (fingerprints in data/catalog-push-state.db,
// 10-17; scripts/test-push-catalog.mjs).
//
// Deliberately NOT pushed: price_series (prod's daily job maintains it with
// fresher points than any local copy), and every user-owned table (users,
// cards, sessions, ... — replaying those would clobber production data).
// Catalog rows are upstream-derived and idempotent, so REPLACE is safe.
//
// Credentials like backup-turso.mjs: TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or
// .env.migration.json (dbUrl/dbToken).
import crypto from "node:crypto";
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
// --only <table[,table]>: push just those catalog tables (09-10: tcg_cards alone, not all 120k rows).
const onlyArg = process.argv[process.argv.indexOf("--only") + 1];
const only = process.argv.includes("--only") && onlyArg ? new Set(onlyArg.split(",")) : null;

const CATALOG_TABLES = [
  "en_cards",
  "jp_cards",
  "zh_cards",
  "species_names",
  "mtg_sets",
  "mtg_cards",
  "tcgplayer_products",
  "tcg_cards",
];

const local = new DatabaseSync(path.join(root, "data", "cardflip.db"), { readOnly: true });
const remote = createClient({ url, authToken });
// What Turso already has, by row fingerprint (see the push loop). Its own file so the
// mirror stays read-only here; deleting it just means one full push.
const state = new DatabaseSync(process.env.CATALOG_PUSH_STATE ?? path.join(root, "data", "catalog-push-state.db"));
state.exec("CREATE TABLE IF NOT EXISTS pushed (tbl TEXT NOT NULL, k TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (tbl, k))");

const ROWS_PER_STMT = 200;
const STMTS_PER_BATCH = 10;
const t0 = Date.now();

for (const table of CATALOG_TABLES) {
  if (only && !only.has(table)) continue;
  const exists = local
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!exists) {
    console.log(`${table}: not in local db — skipped`);
    continue;
  }
  const localCols = local.prepare(`PRAGMA table_info(${table})`).all();
  const cols = localCols.map((c) => c.name);
  const localCount = local.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  let remoteCount = 0;
  try {
    remoteCount = Number((await remote.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  } catch {
    console.log(`${table}: missing on Turso — will create rows only if the app's schema made the table; skipping`);
    continue;
  }
  // A column the local sync added (tcg_cards.ref_image_url, 09-30) has to
  // exist upstream before the REPLACE names it; the app's own probe adds it
  // on its next deploy, but the push must not wait for that.
  const remoteCols = new Set((await remote.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
  for (const c of localCols) {
    if (remoteCols.has(c.name)) continue;
    const def = `${c.name} ${c.type}${c.notnull ? " NOT NULL" : ""}${c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : ""}`;
    console.log(`${table}: adding column ${def} on Turso${dry ? " [dry run]" : ""}`);
    if (!dry) await remote.execute(`ALTER TABLE ${table} ADD COLUMN ${def}`);
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
  // Only rows whose content changed since the last push (10-17, task #23): the
  // syncs re-stamp synced_at on every row every night, so the check above never
  // held and all ~190k rows went up nightly (446 s). A row's fingerprint
  // (every column but synced_at) is kept per table in data/catalog-push-state.db
  // once Turso has accepted its batch; no fingerprint = never pushed = send it.
  const colList = cols.join(", ");
  const keyCols = localCols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  const keyOf = (r) => (keyCols.length ? keyCols.map((c) => String(r[c])).join("\u0001") : JSON.stringify(cols.map((c) => r[c] ?? null)));
  const hashCols = cols.filter((c) => c !== "synced_at");
  const hashOf = (r) => crypto.createHash("sha1").update(JSON.stringify(hashCols.map((c) => r[c] ?? null))).digest("base64");
  const seen = new Map(state.prepare("SELECT k, h FROM pushed WHERE tbl = ?").all(table).map((s) => [s.k, s.h]));
  let rows = [];
  const all = [];
  for (const r of local.prepare(`SELECT ${colList} FROM ${table}`).iterate()) {
    const k = keyOf(r), h = hashOf(r);
    all.push({ r, k, h });
    if (seen.get(k) !== h) rows.push(all[all.length - 1]);
  }
  // Turso short of rows the state says it has (deleted there, or a restore): the state can't be
  // trusted for this table, so send every row once and rebuild it.
  if (localCount - remoteCount > rows.length) {
    console.log(`${table}: remote is ${localCount - remoteCount} rows short but only ${rows.length} changed: pushing all`);
    rows = all;
  }
  if (rows.length === 0 && localCount <= remoteCount) {
    console.log(`${table}: no changed rows (${localCount} rows)`);
    continue;
  }
  console.log(`${table}: pushing ${rows.length} changed of ${localCount} rows (remote has ${remoteCount})${dry ? " [dry run]" : ""}`);
  if (dry) continue;

  const remember = state.prepare("INSERT OR REPLACE INTO pushed (tbl, k, h) VALUES (?, ?, ?)");
  let stmts = [];
  let pending = [];
  const flush = async () => {
    if (stmts.length === 0) return;
    await remote.batch(stmts, "write");
    state.exec("BEGIN");
    for (const p of pending) remember.run(table, p.k, p.h);
    state.exec("COMMIT");
    stmts = [];
    pending = [];
  };
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT) {
    const chunk = rows.slice(i, i + ROWS_PER_STMT);
    const placeholders = chunk.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ");
    const args = chunk.flatMap(({ r }) => cols.map((c) => r[c] ?? null));
    stmts.push({ sql: `INSERT OR REPLACE INTO ${table} (${colList}) VALUES ${placeholders}`, args });
    pending.push(...chunk);
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
