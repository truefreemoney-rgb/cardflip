// Visitor tile: the /api/visit counting ping is refused (403, harmless: VisitPing ignores the answer) from networks
// that are checkers or scraper pools, not shoppers, so the admin daily-visitors tile stops counting them (10-23:
// the 6am "influx" was ~2/3 Google Ads landing-page checkers on fake phone browsers + a nav-page scraper pool).
// Site access is untouched: only the path /api/visit is denied for these ASNs. One rule; re-running adds ASNs.
//   node scripts/_fw-visit-asn.mjs <asn> [asn...]
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const asns = process.argv.slice(2);
if (!asns.length || asns.some((a) => !/^\d+$/.test(a))) throw new Error("usage: node scripts/_fw-visit-asn.mjs <asn> [asn...]");
const NAME = "Visitor tile: checkers + scraper pools don't count (deny /api/visit)";
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const old = (active.rules ?? []).find((r) => r.name === NAME);
const had = old ? old.conditionGroup.map((g) => g.conditions.find((c) => c.type === "geo_as_number").value) : [];
const all = [...new Set([...had, ...asns])];
const value = {
  name: NAME,
  description: "Google Ads landing-page checkers + hosting pools: only the visitor-count ping is refused (10-23).",
  active: true,
  conditionGroup: all.map((asn) => ({ conditions: [{ type: "path", op: "eq", value: "/api/visit" }, { type: "geo_as_number", op: "eq", value: asn }] })),
  action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
};
const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
console.log(body.action, r.status, (await r.text()).slice(0, 300));
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
const mine = (after.rules ?? []).find((r) => r.name === NAME);
console.log(mine ? `ASNs: ${mine.conditionGroup.map((g) => g.conditions[1].value).join(", ")}` : "rule missing");
