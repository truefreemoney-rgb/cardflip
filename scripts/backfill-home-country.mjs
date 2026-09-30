// One-time: users.home_country from signup_log.country (Chris 09-30 travel rule).
//
//   node scripts/backfill-home-country.mjs [--apply] [--prod | --db <file>]
//
// DRY RUN by default: prints each account it would stamp and writes nothing.
// Only fills NULLs. Accounts with no signup_log country stay NULL (= legacy =
// allowed anywhere). An account from OUTSIDE the open countries that has ever
// paid (Stripe customer, subscription, or purchased scans) is left NULL too:
// stamping it would lock a paying customer out with no warning.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const prod = argv.includes("--prod");
const dbArg = argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : null;
const OPEN = new Set(["US", "CA", "GB", "IE", "AU", "NZ"]);

function client() {
  if (prod) {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".env.migration.json"), "utf8").replace(/^﻿/, ""));
    return createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
  }
  const file = path.resolve(dbArg ?? "data/cardflip.db");
  if (!fs.existsSync(file)) throw new Error(`no database at ${file}`);
  return createClient({ url: `file:${file.split(path.sep).join("/")}` });
}

const db = client();
const cols = (await db.execute("PRAGMA table_info(users)")).rows.map((r) => r.name);
if (!cols.includes("home_country")) {
  if (!apply) console.log("(users.home_country does not exist yet; the app adds it on first boot after deploy. Dry run continues as if it were NULL.)");
  else await db.execute("ALTER TABLE users ADD COLUMN home_country TEXT");
}
const homeSel = cols.includes("home_country") ? "u.home_country" : "NULL";
const rows = (
  await db.execute(`
    SELECT u.id, u.email, ${homeSel} AS home, s.country AS country,
           u.stripe_customer_id AS cust, u.sub_status AS sub, COALESCE(u.extra_scans, 0) AS extra
    FROM users u LEFT JOIN signup_log s ON s.user_id = u.id
    ORDER BY u.created_at`)
).rows;

let stamp = 0;
for (const r of rows) {
  const country = r.country ? String(r.country).toUpperCase() : null;
  const paid = Boolean(r.cust || r.sub || Number(r.extra) > 0);
  let action;
  if (r.home) action = `already ${r.home}`;
  else if (!country) action = "no signup country → stays legacy (allowed)";
  else if (!OPEN.has(country) && paid) action = `${country} but has paid → stays legacy (allowed)`;
  else {
    action = `→ ${country}${OPEN.has(country) ? "" : "  (outside the open countries: no access from abroad)"}`;
    stamp += 1;
    if (apply) await db.execute({ sql: "UPDATE users SET home_country = ? WHERE id = ? AND home_country IS NULL", args: [country, r.id] });
  }
  console.log(`${String(r.id).slice(0, 8)}  ${String(r.email).padEnd(36)}  ${action}`);
}
console.log(apply ? `\nStamped ${stamp}.` : `\nWould stamp ${stamp}. Nothing was written; re-run with --apply.`);
