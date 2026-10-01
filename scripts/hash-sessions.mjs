#!/usr/bin/env node
// Session tokens hashed at rest (10-01 sweep), one-time pass: rewrite every
// sessions row that still holds a cookie value to "h:" + its SHA-256, the form
// src/lib/server/sessions.ts stores (sessionKey). The app does the same per
// row the first time its cookie shows up; this takes the rows of people who
// have not come back yet. Nobody is signed out.
//
//   node scripts/hash-sessions.mjs [--apply] [--prod | --db <file>]
//
// DRY RUN by default: prints the counts and writes nothing. Run it only once
// the hashing code is LIVE: the code before it looks rows up by the cookie
// value and would sign out every rewritten row.
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";

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
const rows = (await client.execute("SELECT token FROM sessions")).rows.map((r) => String(r.token));
const raw = rows.filter((t) => /^[0-9a-f]{64}$/.test(t));
const hashed = rows.filter((t) => /^h:[0-9a-f]{64}$/.test(t));
console.log(`${prod ? "PROD" : "local"}: ${rows.length} sessions, ${hashed.length} hashed, ${raw.length} still raw, ${rows.length - raw.length - hashed.length} other`);

if (!apply) {
  console.log("dry run: nothing written (--apply to rewrite the raw rows)");
} else {
  let done = 0;
  for (const token of raw) {
    const key = "h:" + createHash("sha256").update(token).digest("hex");
    const res = await client.execute({ sql: "UPDATE sessions SET token = ? WHERE token = ?", args: [key, token] });
    done += Number(res.rowsAffected);
  }
  console.log(`rewrote ${done} of ${raw.length}`);
}
client.close();
