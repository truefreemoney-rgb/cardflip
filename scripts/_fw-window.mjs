// Read-only: who was ALLOWED in one window (ET), from the Firewall metrics API, grouped by AS + JA4 + path.
// node scripts/_fw-window.mjs "2026-10-21T19:30" "2026-10-21T20:15"   (times in ET, 24 h)
import fs from "node:fs";
const local = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^ï»¿/, ""));
const token = process.env.VERCEL_TOKEN || local.vercelToken;
const TEAM = "team_l73XXJDNrLnYFezMhk8bn2K2";
const PRJ = "prj_GlXQxal5IAh2oG0zls2ZGjhK212b";
const auth = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error("usage: _fw-window.mjs <start ET> <end ET>");
// ET = UTC-4 in October.
const start = new Date(`${a}:00-04:00`), end = new Date(`${b}:00-04:00`);
async function metric(filter, groupBy, limit) {
  const body = {
    metrics: { value: { metric: "vercel.firewall_action.count", aggregation: "count" } },
    outputs: ["value"], filter, groupBy, bucketSeconds: Math.max(60, Math.round((end - start) / 1000)),
    seriesSelection: { limit, mode: "exact", rankBy: [{ metric: "value", direction: "desc" }] },
    scope: { ownerId: TEAM, projectIds: [PRJ] },
    timeRange: { start: start.toISOString(), end: end.toISOString() },
  };
  const r = await fetch(`https://api.vercel.com/observability-api/v1/metrics?teamId=${TEAM}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`metrics ${r.status} ${(await r.text()).slice(0, 200)}`);
  const totals = new Map();
  for (const s of (await r.json()).series ?? []) {
    const key = groupBy.map((g) => s.dimensions[g] ?? "").join("\t");
    totals.set(key, (totals.get(key) ?? 0) + s.values.value);
  }
  return [...totals].sort((x, y) => y[1] - x[1]);
}
const allowed = "wafAction:allow";
for (const groupBy of [["asnName", "clientJa4Digest"], ["requestPath"], ["userAgent"], ["clientIp"]]) {
  console.log(`== allowed ${a} .. ${b} ET by ${groupBy.join(" + ")}`);
  const rows = await metric(allowed, groupBy, 500); console.log(`  total ${rows.reduce((n, [, v]) => n + v, 0)} across ${rows.length} series`); for (const [k, v] of rows.slice(0, 8)) console.log(`  ${String(v).padStart(6)}  ${k.slice(0, 150)}`);
}
