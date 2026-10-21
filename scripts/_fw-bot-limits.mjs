// Two crawler rules (Chris 10-21 ~7:20pm ET "do them now", after a 6:45pm spike: OAI-SearchBot 1,618 card pages in
// ~15 min from ~8 Azure IPs, each a page build; HeadlessChrome on AWS ~1K a day):
//  1. OAI-SearchBot stays allowed (ChatGPT search sends visitors) but at most 60 requests a minute per TLS fingerprint
//     (its ~8 IPs share one JA4, so this caps the bot as a whole; over the cap = 429 until the minute ends).
//  2. HeadlessChrome (a script-driven browser; people never browse with it) denied site-wide, except our smoke
//     header and Google's networks. Live Playwright runs against prod need a normal UA or the smoke header now.
//   node scripts/_fw-bot-limits.mjs
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config", qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const smoke = active.rules.flatMap((r) => r.conditionGroup.flatMap((g) => g.conditions)).find((c) => c.type === "header" && c.key === "x-cf-smoke");
const rules = [
  {
    name: "Crawlers: OAI-SearchBot 60/min (rate limit)",
    description: "ChatGPT search stays allowed, spread out (10-21).",
    active: true,
    conditionGroup: [{ conditions: [{ type: "user_agent", op: "re", value: "OAI-SearchBot" }] }],
    action: { mitigate: { action: "rate_limit", rateLimit: { algo: "fixed_window", window: 60, limit: 60, keys: ["ja4"], action: "deny" }, redirect: null, actionDuration: null } },
  },
  {
    name: "Scrapers: HeadlessChrome (deny)",
    description: "Script-driven browsers, never people (10-21). Smoke + Google exempt.",
    active: true,
    conditionGroup: [{ conditions: [
      { type: "user_agent", op: "re", value: "HeadlessChrome" },
      { type: "geo_as_number", op: "inc", neg: true, value: ["15169", "396982"] },
      { ...smoke },
    ] }],
    action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
  },
];
for (const value of rules) {
  const old = active.rules.find((r) => r.name === value.name);
  const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
  const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  console.log(value.name, body.action, r.status, (await r.text()).slice(0, 200));
}
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
for (const r of after.rules.filter((x) => rules.some((y) => y.name === x.name))) console.log(`- ${r.name} | ${r.action.mitigate.action} ${JSON.stringify(r.action.mitigate.rateLimit ?? "")} | ${JSON.stringify(r.conditionGroup).replace(/"value":"[0-9a-f]{20,}"/, '"value":"<smoke>"')}`);
