// Delete the 14 junk waitlist rows of the 10-20/21 probe waves (Chris 10-21 ~1:15am ET: "1. yes").
// Only these exact addresses, only rows made 10-20 11:28pm - 10-21 12:47am ET.
//   node scripts/_delete-waitlist-probes-1021.mjs [--go]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const EMAILS = [
  "probe49777w@example.org", "support@cardflip.io", "probe49777new@example.org", "x@example.invalid", "probe.50021@example.invalid",
  "support@cardflip.com", "probe-waitlist-991@example.com", "wl17925555508748@example.com", "zz-nobody-50404@example.com",
  "probe50406z2@example.org", "admin@cardflip.io.", "admin@cardflip.io..", "zzz-rs-6612@example.com", "zzrnd_9k2mq@example.com",
];
const FROM = Date.parse("2026-10-21T03:28:00Z");
const TO = Date.parse("2026-10-21T04:48:00Z");
const where = `email IN (${EMAILS.map(() => "?").join(",")}) AND created_at BETWEEN ? AND ?`;
const args = [...EMAILS, FROM, TO];
const rows = (await c.execute({ sql: `SELECT email, created_at FROM waitlist WHERE ${where}`, args })).rows;
console.log(`matching ${rows.length} of ${EMAILS.length}`);
if (!process.argv.includes("--go")) { for (const r of rows) console.log("  ", JSON.stringify(r.email)); process.exit(0); }
const res = await c.execute({ sql: `DELETE FROM waitlist WHERE ${where}`, args });
console.log("deleted", res.rowsAffected);
const left = (await c.execute({ sql: `SELECT COUNT(*) AS n FROM waitlist WHERE ${where}`, args })).rows[0].n;
console.log("left", left, "| waitlist total now", (await c.execute("SELECT COUNT(*) AS n FROM waitlist")).rows[0].n);
