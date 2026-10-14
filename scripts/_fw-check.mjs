// Read-only: the Vercel Firewall custom rules on the cardflip project (name, active, action). 10-13.
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const r = await fetch("https://api.vercel.com/v1/security/firewall/config/active?projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2", { headers: { Authorization: `Bearer ${m.vercelToken}` } });
const j = await r.json();
console.log("status", r.status, "firewallEnabled", j.firewallEnabled);
for (const rule of j.rules ?? []) console.log(`- ${rule.name} | active ${rule.active} | action ${rule.action?.mitigate?.action} | ${JSON.stringify(rule.conditionGroup).slice(0, 220)}`);
