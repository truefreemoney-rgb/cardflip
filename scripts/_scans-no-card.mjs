// Read-only (10-30, Lucas): charged scans that never became a card. A scan's id is the saved card's client_id
// (app/page.tsx clientId: vision.scanId), so a charged, unrefunded scan_usage row with no cards row (live or removed)
// carrying that id = the seller paid and got nothing. node scripts/_scans-no-card.mjs [days=14]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const days = Number(process.argv[2] ?? 14);
const since = Math.max(Date.now() - days * 86400000, Date.parse("2026-10-24T04:00:00Z")); // client_id = scan id only from the 10-22 push on
const et = (t) => new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York" });
const rows = (
  await c.execute({
    sql: `SELECT s.id, s.user_id, s.at, s.draw, s.read, u.email, u.role
          FROM scan_usage s JOIN users u ON u.id = s.user_id
          WHERE s.at >= ? AND s.refunded_at IS NULL AND s.draw IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.user_id = s.user_id AND c.client_id = s.id)
            AND NOT EXISTS (SELECT 1 FROM card_removals r WHERE r.user_id = s.user_id AND r.created_at BETWEEN s.at - 60000 AND s.at + 300000)
          ORDER BY u.email, s.at`,
    args: [since],
  })
).rows;
const total = (await c.execute({ sql: "SELECT COUNT(*) n FROM scan_usage WHERE at >= ? AND draw IS NOT NULL", args: [since] })).rows[0].n;
const by = new Map();
for (const r of rows) {
  const k = `${r.email}${r.role === "admin" ? " (admin)" : ""}`;
  if (!by.has(k)) by.set(k, []);
  let name = "?";
  try { const j = JSON.parse(r.read); name = `${j.name ?? "?"} ${j.number ?? ""} conf ${j.conf ?? "?"}${j.second ? " +closeup" : ""}`; } catch {}
  let kind = "?";
  try { const d = JSON.parse(r.draw); kind = Object.entries(d).filter(([k, v]) => typeof v === "number" && v > 0).map(([k]) => k).join("+") || "none"; } catch {}
  by.get(k).push(`${et(r.at)} ${kind} | ${name}`);
}
console.log(`last ${days} days: ${total} charged scans, ${rows.length} charged with no card saved, ${by.size} accounts`);
for (const [k, list] of by) {
  console.log(`\n${k}: ${list.length}`);
  for (const l of list) console.log("  " + l);
}
