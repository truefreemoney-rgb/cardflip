// Deny one scraper inside a network real people also use: ASN AND its TLS fingerprints (JA4), so the network's real
// customers still get in. Wave Broadband AS11404 10-21 ~1:40pm ET (Chris: "go with your recommendation"): ~19K deep
// card pages since 4am ET from thousands of 154.x / 45.204.x proxy IPs under a fake Mac Edg/148 name, two JA4s only.
// Re-running with the same company replaces the rule's fingerprint list instead of adding a second rule.
//   node scripts/_fw-block-ja4.mjs "<Company>" <asn> <ja4> [ja4...]
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const [company, asn, ...ja4s] = process.argv.slice(2);
if (!company || !/^\d+$/.test(asn ?? "") || !ja4s.length) throw new Error('usage: node scripts/_fw-block-ja4.mjs "<Company>" <asn> <ja4> [ja4...]');
const NAME = `Scrapers: ${company} proxy fingerprints (deny)`;
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const old = (active.rules ?? []).find((r) => r.name === NAME);
const value = {
  name: NAME,
  description: `Scraper on ${company} AS${asn}, fake browser name; its JA4s only (10-21).`,
  active: true,
  conditionGroup: [{ conditions: [
    { type: "geo_as_number", op: "eq", value: asn },
    { type: "ja4_digest", op: "inc", value: ja4s },
  ] }],
  action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
};
const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
console.log(body.action, r.status, (await r.text()).slice(0, 300));
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
for (const rule of after.rules ?? []) console.log(`- ${rule.name} | active ${rule.active} | ${rule.action?.mitigate?.action} | ${JSON.stringify(rule.conditionGroup).slice(0, 200)}`);
