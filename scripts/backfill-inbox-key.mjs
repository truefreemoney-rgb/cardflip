#!/usr/bin/env node
// One free trial per inbox (Chris 10-01), one-time pass: add signup_log.inbox_key
// and its index if the app has not yet (same DDL as src/lib/db.ts), then fill the
// key for every signup_log row whose account still exists, from the account's
// current address (src/lib/inboxKey.ts: Gmail dot and plus spellings are one).
// Rows of deleted accounts keep NULL: their address is gone.
//
//   node --experimental-strip-types --no-warnings scripts/backfill-inbox-key.mjs [--apply] [--prod | --db <file>]
//
// DRY RUN by default: prints the counts and writes nothing. Safe before the
// deploy: older code never reads the column.
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@libsql/client";

const { inboxKey } = await import("../src/lib/inboxKey.ts");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const prod = args.includes("--prod");
const dbArg = args.includes("--db") ? args[args.indexOf("--db") + 1] : null;
if (prod && dbArg) throw new Error("use --prod or --db, not both");

function openClient() {
  if (prod) {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
    return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
  }
  const file = path.resolve(dbArg ?? path.join(process.cwd(), "data", "cardflip.db"));
  if (!fs.existsSync(file)) throw new Error(`no database at ${file}`);
  return createClient({ url: `file:${file.replace(/\\/g, "/")}` });
}

const client = openClient();
const hasColumn = (await client.execute("SELECT 1 FROM pragma_table_info('signup_log') WHERE name = 'inbox_key'")).rows.length === 1;
console.log(`${prod ? "PROD" : "local"}: signup_log.inbox_key ${hasColumn ? "exists" : "is missing"}`);
if (!hasColumn && apply) {
  await client.execute("ALTER TABLE signup_log ADD COLUMN inbox_key TEXT");
  console.log("column added");
}
if (apply) await client.execute("CREATE INDEX IF NOT EXISTS idx_signup_log_inbox ON signup_log (inbox_key)");

const rows = (await client.execute(
  `SELECT s.user_id AS id, u.email AS email${hasColumn || apply ? ", s.inbox_key AS k" : ""} FROM signup_log s LEFT JOIN users u ON u.id = s.user_id`,
)).rows;
const todo = rows.filter((r) => r.email && !r.k);
const keys = new Map();
for (const r of rows) if (r.email) keys.set(inboxKey(String(r.email)), (keys.get(inboxKey(String(r.email))) ?? 0) + 1);
console.log(`${rows.length} signup rows: ${todo.length} to fill, ${rows.filter((r) => r.k).length} filled, ${rows.filter((r) => !r.email).length} of deleted accounts (left empty)`);
console.log(`inboxes shared by more than one account today: ${[...keys.values()].filter((n) => n > 1).length}`);

if (!apply) {
  console.log("dry run: nothing written (--apply to add the column and fill the keys)");
} else {
  let done = 0;
  for (const r of todo) {
    const res = await client.execute({ sql: "UPDATE signup_log SET inbox_key = ? WHERE user_id = ? AND inbox_key IS NULL", args: [inboxKey(String(r.email)), r.id] });
    done += Number(res.rowsAffected);
  }
  console.log(`filled ${done} of ${todo.length}`);
}
client.close();
