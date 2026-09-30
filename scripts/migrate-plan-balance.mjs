#!/usr/bin/env node
// Scan rollover, one-time move (Chris, 09-30): give every real Stripe subscriber a
// plan balance (users.plan_scans) equal to what was left of SEPTEMBER's allowance,
// so nobody loses a paid scan when the calendar reset goes away.
//
//   npm run migrate:planscans -- [--apply] [--prod | --db <file>] [--month 2026-09]
//
// DRY RUN by default: prints what each subscriber would get and writes nothing.
// --apply writes. Target: --prod = Turso (.env.migration.json), --db <file> = a
// local sqlite file, default = data/cardflip.db in the current directory.
//
// The rule (src/lib/planSeed.ts, shared with the app's own lazy seed): seed =
// plan cap - scans used in the seed MONTH (2026-09), read from the users row's
// counter. The month is fixed, not read from the clock, so the answer is the
// same before and after the old counter's reset at Oct 1 00:00 UTC (8pm ET
// Sep 30). If the old code already rolled the row to October (its September
// count overwritten), September's use is read from the scan_usage ledger
// instead; a row with no September trace seeds the full cap.
//
// Safety:
//  - never touches an account with an access override (legacy, comped,
//    unlimited, trial), an admin or the owner: they are listed and skipped.
//    An override on an account that is LIVE in Stripe is flagged loudly: the
//    customer is paying for a balance they cannot see (look at it by hand);
//  - only rows whose plan_scans is still NULL are seeded; a balance that a
//    paid invoice already credited is never overwritten (the app seeds in the
//    same transaction as that credit), and the seed ADDS, never assigns;
//  - the ledger row migration:<userId> is the idempotency key, written in the
//    same transaction as the balance, so a second run (or the app's lazy seed
//    getting there first) changes nothing;
//  - --apply creates the columns and the ledger table if the app has not yet
//    (same DDL as src/lib/db.ts; scripts/test-rollover.mjs pins that they match).
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@libsql/client";

const { PRICING } = await import("../src/lib/pricing.ts");
const { CREDITS_FROM, SEED_MONTH, seedAmount, seedKey } = await import("../src/lib/planSeed.ts");

// Same value as OWNER_EMAIL in src/lib/server/users.ts (that module is server-only).
const OWNER_EMAIL = "truefreemoney@gmail.com";
const LIVE = ["active", "trialing", "past_due"];

function parseArgs(argv) {
  const opts = { apply: false, prod: false, db: null, month: SEED_MONTH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opts.apply = true;
    else if (a === "--prod") opts.prod = true;
    else if (a === "--db") opts.db = argv[++i];
    else if (a === "--month") opts.month = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!/^\d{4}-\d{2}$/.test(opts.month)) throw new Error("--month must look like 2026-09");
  if (opts.prod && opts.db) throw new Error("use --prod or --db, not both");
  return opts;
}

function openClient(opts) {
  if (opts.prod) {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
    return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
  }
  const file = path.resolve(opts.db ?? path.join(process.cwd(), "data", "cardflip.db"));
  if (!fs.existsSync(file)) throw new Error(`no database at ${file}`);
  return createClient({ url: `file:${file.replace(/\\/g, "/")}` });
}

/** The columns and table src/lib/db.ts adds for rollover (kept identical; test-rollover.mjs compares them). */
const COLUMNS = [
  "plan_scans INTEGER",
  "plan_credit_scans INTEGER NOT NULL DEFAULT 0",
  "plan_credit_at INTEGER",
  "sub_cancel_at INTEGER",
];
const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS scan_credits (
    credit_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    plan TEXT,
    scans INTEGER NOT NULL,
    applied INTEGER NOT NULL,
    balance_before INTEGER,
    price_id TEXT,
    ref_key TEXT,
    charge_id TEXT,
    payment_intent TEXT,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scan_credits_user ON scan_credits(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_scan_credits_ref ON scan_credits(ref_key);
  CREATE INDEX IF NOT EXISTS idx_scan_credits_charge ON scan_credits(charge_id);
`;

async function tableColumns(client, table) {
  const rs = await client.execute(`PRAGMA table_info(${table})`);
  return new Set(rs.rows.map((r) => String(r.name)));
}

async function ensureSchema(client) {
  await client.executeMultiple(LEDGER_DDL);
  const have = await tableColumns(client, "users");
  for (const col of COLUMNS) {
    if (!have.has(col.split(" ")[0])) await client.execute(`ALTER TABLE users ADD COLUMN ${col}`);
  }
}

/** Scans the old counter never saw: real scan rows in scan_usage for the month (locate and tiebreak calls are not scans). */
async function ledgerUsed(client, userId, month) {
  try {
    const [y, m] = month.split("-").map(Number);
    const from = Date.UTC(y, m - 1, 1);
    const to = Date.UTC(y, m, 1);
    const rs = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM scan_usage
            WHERE user_id = ? AND at >= ? AND at < ?
              AND (read IS NULL OR (read NOT LIKE '%"locate"%' AND read NOT LIKE '%"tiebreak"%'))`,
      args: [userId, from, to],
    });
    return Number(rs.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Decide, for every account live in Stripe, what happens to it. Reads only. */
export async function plan(client, opts) {
  const users = await tableColumns(client, "users");
  const hasBalance = users.has("plan_scans");
  const hasLedger = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scan_credits'")).rows.length > 0;
  const rows = (await client.execute({ sql: `SELECT * FROM users WHERE sub_status IN (${LIVE.map(() => "?").join(", ")}) ORDER BY created_at`, args: LIVE })).rows;
  const out = [];
  for (const r of rows) {
    const id = String(r.id);
    const base = { id, status: String(r.sub_status), plan: r.plan === "pro" ? "pro" : "standard", override: r.access_override ?? null, before: hasBalance ? (r.plan_scans ?? null) : null };
    if (r.access_override) {
      out.push({ ...base, action: "skip", why: `access override "${r.access_override}"`, flag: `LIVE in Stripe (${r.sub_status}) but on override "${r.access_override}": the customer pays for a balance they cannot see, look at this account by hand` });
      continue;
    }
    if (r.role === "admin" || String(r.email).toLowerCase() === OWNER_EMAIL) {
      out.push({ ...base, action: "skip", why: "owner or admin account" });
      continue;
    }
    if (Number(r.created_at) >= CREDITS_FROM) {
      out.push({ ...base, action: "skip", why: "account made on or after Oct 1: first paid under the new rules, no old allowance is owed" });
      continue;
    }
    if (hasBalance && r.plan_scans !== null && r.plan_scans !== undefined) {
      out.push({ ...base, action: "skip", why: `already has a balance (${r.plan_scans})` });
      continue;
    }
    if (hasLedger) {
      const done = await client.execute({ sql: "SELECT scans FROM scan_credits WHERE credit_key = ?", args: [seedKey(id)] });
      if (done.rows.length) {
        out.push({ ...base, action: "skip", why: `already migrated (seed ${done.rows[0].scans})` });
        continue;
      }
    }
    const cap = PRICING[base.plan].scans;
    const counterHasMonth = r.scan_month === opts.month;
    let used = counterHasMonth ? Number(r.scans_used ?? 0) : 0;
    let source = counterHasMonth ? `counter ${opts.month}` : "no counter for the month";
    if (!counterHasMonth && r.scan_month) {
      // The old code already moved this row on; September's count is gone from it.
      const n = await ledgerUsed(client, id, opts.month);
      if (n > 0) {
        used = n;
        source = `scan_usage ledger (the row moved on to ${r.scan_month})`;
      }
    }
    const seed = seedAmount(cap, SEED_MONTH, used);
    // The counter says nothing about September: this is either an old subscriber who did not
    // scan in September (owed the full allowance) or an older account that first SUBSCRIBED on
    // or after Oct 1 (owed nothing). The script cannot tell them apart; the daily credit job
    // takes the seed back if the first invoice was paid after Oct 1, but check Stripe first.
    const check = !counterHasMonth ? `counter is "${r.scan_month ?? "empty"}", not ${opts.month}: seeds the full allowance; if this person first subscribed on or after Oct 1 they are owed nothing, check their first invoice in Stripe` : null;
    out.push({ ...base, action: "seed", seed, cap, used, source, ...(check ? { check } : {}) });
  }
  return out;
}

/** Write one seed: the ledger row and the balance in ONE transaction; adds, never assigns. */
async function applySeed(client, entry, now) {
  const tx = await client.transaction("write");
  try {
    const ins = await tx.execute({
      sql: `INSERT OR IGNORE INTO scan_credits (credit_key, user_id, kind, plan, scans, applied, balance_before, note, created_at)
            VALUES (?, ?, 'migration', ?, ?, ?, 0, ?, ?)`,
      args: [seedKey(entry.id), entry.id, entry.plan, entry.seed, entry.seed, `migration script: ${entry.source}`, now],
    });
    let wrote = false;
    if (ins.rowsAffected > 0) {
      await tx.execute({ sql: "UPDATE users SET plan_scans = COALESCE(plan_scans, 0) + ? WHERE id = ?", args: [entry.seed, entry.id] });
      wrote = true;
    }
    await tx.commit();
    return wrote;
  } catch (err) {
    try { tx.close(); } catch { /* already closed */ }
    throw err;
  }
}

export async function run(argv, log = console.log) {
  const opts = parseArgs(argv);
  const client = openClient(opts);
  try {
    if (opts.apply) await ensureSchema(client);
    const entries = await plan(client, opts);
    log(`${opts.apply ? "APPLY" : "DRY RUN"}: seeding from ${opts.month} on ${opts.prod ? "Turso (prod)" : opts.db ?? "data/cardflip.db"}; ${entries.length} subscriber(s) live in Stripe`);
    let seeded = 0;
    for (const e of entries) {
      const tag = e.id.slice(0, 8);
      if (e.action === "seed") {
        let result = `plan_scans ${e.before ?? "NULL"} -> ${e.seed}`;
        if (opts.apply) {
          const wrote = await applySeed(client, e, Date.now());
          result = wrote ? result : "left alone (another writer seeded first)";
          if (wrote) seeded++;
        }
        log(`  ${tag} ${e.plan} ${e.status}: ${result}  [${e.plan} cap ${e.cap}, used ${e.used} from ${e.source}]${e.check ? `\n         ?? ${e.check}` : ""}`);
      } else {
        log(`  ${tag} ${e.plan} ${e.status}: SKIPPED, ${e.why}${e.flag ? `\n         !! ${e.flag}` : ""}`);
      }
    }
    const skipped = entries.filter((e) => e.action === "skip");
    const flagged = skipped.filter((e) => e.flag);
    log(opts.apply ? `Seeded ${seeded}, skipped ${skipped.length}.` : `Would seed ${entries.length - skipped.length}, skip ${skipped.length}. Nothing was written; re-run with --apply.`);
    const checks = entries.filter((e) => e.action === "seed" && e.check);
    if (checks.length) log(`Check in Stripe before --apply: ${checks.map((e) => e.id.slice(0, 8)).join(", ")} (no September counter; may have first subscribed after Oct 1).`);
    if (flagged.length) log(`Needs a human: ${flagged.map((e) => e.id.slice(0, 8)).join(", ")} (live in Stripe on an override).`);
    return { opts, entries, seeded };
  } finally {
    client.close();
  }
}

// Run only as a script (the test imports run() directly).
if (process.argv[1]?.endsWith("migrate-plan-balance.mjs")) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
