// Firewall: no sign-up / sign-in calls (/api/auth/*) from cloud server networks (Chris 10-20 11:40pm ET, after the AWS
// account-probing bot: "No sign-ups from servers"). Browsing is untouched. Microsoft (AS8075) is added only after the
// prod-smoke pass header ships (GitHub's runners live there); re-run with --with-microsoft then.
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const NAME = "Abuse: sign-up/sign-in from cloud servers (deny)";
// Cloud hosts only. Never Cloudflare/Akamai/Fastly (iCloud Private Relay) or VPN carriers like M247.
const ASNS = {
  "16509": "Amazon AWS", "14618": "Amazon AWS", "396982": "Google Cloud", "15169": "Google", "14061": "DigitalOcean",
  "16276": "OVH", "24940": "Hetzner", "63949": "Linode", "20473": "Vultr", "31898": "Oracle Cloud", "45102": "Alibaba Cloud",
  "51167": "Contabo",
};
if (process.argv.includes("--with-microsoft")) ASNS["8075"] = "Microsoft Azure";
const pass = m.smokePass; // header value prod-smoke sends; absent until set
const groups = Object.keys(ASNS).map((asn) => ({
  conditions: [
    { type: "path", op: "pre", value: "/api/auth/" },
    { type: "geo_as_number", op: "eq", value: asn },
    ...(pass ? [{ type: "header", key: "x-cf-smoke", op: "eq", neg: true, value: pass }] : []),
  ],
}));
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const old = (active.rules ?? []).find((r) => r.name === NAME);
const value = {
  name: NAME,
  description: `Cloud networks: ${Object.values(ASNS).filter((v, i, a) => a.indexOf(v) === i).join(", ")}. Real people do not sign up from servers.`,
  active: true,
  conditionGroup: groups,
  action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
};
const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
console.log(body.action, r.status, (await r.text()).slice(0, 300));
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
for (const rule of after.rules ?? []) console.log(`- ${rule.name} | ${rule.action?.mitigate?.action} | groups ${rule.conditionGroup.length}`);
