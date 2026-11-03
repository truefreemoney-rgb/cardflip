// Read-only: Google's own network (AS15169) at the firewall, last 23 h: allowed vs denied/challenged, by user agent.
import fs from "node:fs";
const local = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const TEAM = "team_l73XXJDNrLnYFezMhk8bn2K2", PRJ = "prj_GlXQxal5IAh2oG0zls2ZGjhK212b";
const auth = { Authorization: `Bearer ${local.vercelToken}`, "content-type": "application/json" };
const end = new Date(Math.floor(Date.now() / 3600e3) * 3600e3), start = new Date(end - 6 * 3600e3);
async function metric(filter, groupBy) {
  const body = { metrics: { value: { metric: "vercel.firewall_action.count", aggregation: "count" } }, outputs: ["value"], filter, groupBy,
    bucketSeconds: 3600, seriesSelection: { limit: 40, mode: "exact", rankBy: [{ metric: "value", direction: "desc" }] },
    scope: { ownerId: TEAM, projectIds: [PRJ] }, timeRange: { start: start.toISOString(), end: end.toISOString() } };
  const r = await fetch(`https://api.vercel.com/observability-api/v1/metrics?teamId=${TEAM}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`metrics ${r.status} ${(await r.text()).slice(0, 300)}`);
  const t = new Map();
  for (const s of (await r.json()).series ?? []) { const k = groupBy.map((g) => s.dimensions[g] ?? "").join(" | "); t.set(k, (t.get(k) ?? 0) + s.values.value); }
  return [...t].sort((x, y) => y[1] - x[1]);
}
for (const [label, f, g] of [
  ["AS15169 by action + UA", 'asnId:"15169"', ["wafAction", "userAgent"]],
  ["Googlebot UA (any network) by action + ASN", 'userAgent:"*Googlebot*"', ["wafAction", "asnName"]],
]) {
  console.log("== " + label);
  try { for (const [k, v] of (await metric(f, g)).slice(0, 15)) console.log(String(v).padStart(7), k.slice(0, 170)); } catch (e) { console.log("  " + e.message); }
}
