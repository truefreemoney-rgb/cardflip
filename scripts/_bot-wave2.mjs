// READ ONLY: the 10-21 probe sign-ups. Who, from which network (signup_log), what the rate-limit rows hold (raw IPs), shut-outs.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const et = (t) => (t ? new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "-");
const since = Date.parse(process.argv[2] ?? "2026-10-21T03:30:00Z");

const cols = (await c.execute("PRAGMA table_info(users)")).rows.map((r) => r.name);
const created = cols.includes("created_at") ? "created_at" : cols.find((x) => /created/.test(x));
const slCols = (await c.execute("PRAGMA table_info(signup_log)")).rows.map((r) => r.name);
const extra = ["country", "src", "landing", "ref_host", "inbox_key"].filter((x) => slCols.includes(x)).map((x) => `s.${x}`).join(", ");
const u = await c.execute({
  sql: `SELECT u.id, u.email, u.name, u.${created} AS created, u.email_pending, u.trial_scans_used, s.ip_hash, s.device_id, s.at${extra ? `, ${extra}` : ""}
        FROM users u LEFT JOIN signup_log s ON s.user_id = u.id WHERE u.${created} > ? ORDER BY u.${created}`,
  args: [since],
});
console.log(`users since ${et(since)} ET: ${u.rows.length}`);
for (const r of u.rows) console.log(et(r.created), JSON.stringify(r.email), r.name, "pending", r.email_pending, "trial", r.trial_scans_used, "ip", String(r.ip_hash ?? "-").slice(0, 8), "dev", String(r.device_id ?? "-").slice(0, 8), r.country ?? "", r.src ?? "", r.landing ?? "", r.ref_host ?? "");

const byIp = new Map();
for (const r of u.rows) byIp.set(r.ip_hash ?? "-", (byIp.get(r.ip_hash ?? "-") ?? 0) + 1);
console.log("\nsign-ups per network hash:", JSON.stringify([...byIp]));

const rl = await c.execute({ sql: "SELECT key, count, window_start FROM rate_limits WHERE window_start > ? ORDER BY window_start", args: [since - 3600_000] });
const ipRe = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7})/i;
const ipKeys = new Map();
for (const r of rl.rows) {
  const m = ipRe.exec(String(r.key));
  if (!m) continue;
  const ip = m[1];
  const list = ipKeys.get(ip) ?? [];
  list.push(`${String(r.key).replace(ip, "*")}=${r.count}@${et(r.window_start)}`);
  ipKeys.set(ip, list);
}
console.log(`\nrate_limits rows with an IP since ${et(since - 3600_000)} ET: ${ipKeys.size} IPs`);
for (const [ip, list] of [...ipKeys].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(ip, list.length, list.slice(0, 12).join("  "));
const sig = rl.rows.filter((r) => /^signup_(made|capped)_|trialblock_|shutout:/.test(String(r.key)));
console.log("\nsignup/shut-out counters:");
for (const r of sig) console.log(" ", String(r.key).slice(0, 60), r.count, et(r.window_start));

const evCols = (await c.execute("PRAGMA table_info(error_events)")).rows.map((r) => r.name);
const evAt = evCols.find((x) => /^(at|created_at|ts|time)$/.test(x)) ?? evCols[0];
const ev = await c.execute({ sql: `SELECT * FROM error_events WHERE ${evAt} > ? ORDER BY ${evAt}`, args: [since] });
console.log(`\nerror_events since: ${ev.rows.length} (cols ${evCols.join(",")})`);
for (const r of ev.rows) {
  const s = JSON.stringify(r);
  if (/shut out|signup|sign-up|auth|probe|429/i.test(s)) console.log(" ", s.slice(0, 300));
}
