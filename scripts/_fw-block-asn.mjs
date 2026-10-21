// Deny every request from one hosting company's networks at the Vercel Firewall (Chris 10-21 ~1:50am ET: "i dont want
// users on vpns anyway", "i mean just rackdog"). Rackdog: ~2.8K page loads a day under a stale fake Firefox/151 name,
// the same disguise Meta's crawler used. One rule per company; re-running adds new ASNs to it instead of a second rule.
// ASNs from RIPEstat (stat.ripe.net searchcomplete "Rackdog"). Never Cloudflare/Akamai/Fastly (iCloud Private Relay).
// Fourplex Telecom (AS27284) 10-21 ~2:10am ET, Chris "yes, if it dosnt block normal users": one-person proxy/server
// network (ARIN 2025), 83 requests in the past day, all from tonight's sign-up bot.
//   node scripts/_fw-block-asn.mjs "<Company>" <asn> [asn...] [--label=Abuse] [--why="<description>"]
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const [company, ...asns] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!company || !asns.length || asns.some((a) => !/^\d+$/.test(a))) throw new Error('usage: node scripts/_fw-block-asn.mjs "<Company>" <asn> [asn...]');
const NAME = `${opt("label") ?? "Scrapers"}: ${company} hosting network (deny)`;
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const old = (active.rules ?? []).find((r) => r.name === NAME);
const had = old ? old.conditionGroup.map((g) => g.conditions[0].value) : [];
const all = [...new Set([...had, ...asns])];
const value = {
  name: NAME,
  description: opt("why") ?? `${company} servers: page scraping under fake browser names, no real shoppers (10-21).`,
  active: true,
  conditionGroup: all.map((asn) => ({ conditions: [{ type: "geo_as_number", op: "eq", value: asn }] })),
  action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
};
const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
console.log(body.action, r.status, (await r.text()).slice(0, 300));
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
for (const rule of after.rules ?? []) console.log(`- ${rule.name} | active ${rule.active} | ${rule.action?.mitigate?.action} | ${JSON.stringify(rule.conditionGroup).slice(0, 160)}`);
