// Add the /pics rate-limit rule to the Vercel Firewall (Chris 10-13: "yes add the rate limit rule"): one IP pulling more than
// 600 card pictures in 60 s is denied, and stays blocked 10 minutes. Run once; it refuses to add a second copy.
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const NAME = "Card pictures: bulk download rate limit";

const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
if ((active.rules ?? []).some((r) => r.name === NAME)) {
  console.log("already there");
} else {
  const body = {
    action: "rules.insert",
    id: null,
    value: {
      name: NAME,
      description: "One IP pulling more than 600 /pics images in 60 s is denied for 10 minutes (scrapers; a person browsing never gets near it).",
      active: true,
      conditionGroup: [{ conditions: [{ type: "path", op: "pre", value: "/pics/" }] }],
      action: { mitigate: { action: "rate_limit", rateLimit: { algo: "fixed_window", window: 60, limit: 600, keys: ["ip"], action: "deny" }, actionDuration: "10m" } },
    },
  };
  const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  console.log("insert", r.status, (await r.text()).slice(0, 400));
}
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
for (const rule of after.rules ?? []) console.log(`- ${rule.name} | active ${rule.active} | ${JSON.stringify(rule.action?.mitigate)}`);
