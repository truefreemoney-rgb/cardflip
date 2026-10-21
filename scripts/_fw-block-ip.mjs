// Deny listed IPs at the Vercel Firewall (Chris 10-20 11:15pm ET: "Block it + delete its accounts" for the sign-up/account
// probing bot on 35.183.7.202, Google Cloud Toronto). One rule; re-running adds any new IP to it instead of a second rule.
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const NAME = "Abuse: account-probing bots by IP (deny)";
const ips = process.argv.slice(2);
if (!ips.length) throw new Error("usage: node scripts/_fw-block-ip.mjs <ip> [ip...]");
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const old = (active.rules ?? []).find((r) => r.name === NAME);
const had = old ? old.conditionGroup.map((g) => g.conditions[0].value) : [];
const all = [...new Set([...had, ...ips])];
const value = {
  name: NAME,
  description: "Bots probing sign-in, sign-up and account endpoints (35.183.7.202: 4 junk accounts, code guessing, 10-20).",
  active: true,
  conditionGroup: all.map((ip) => ({ conditions: [{ type: "ip_address", op: "eq", value: ip }] })),
  action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
};
const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
console.log(body.action, r.status, (await r.text()).slice(0, 300));
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
for (const rule of after.rules ?? []) console.log(`- ${rule.name} | active ${rule.active} | ${rule.action?.mitigate?.action} | ${JSON.stringify(rule.conditionGroup).slice(0, 160)}`);
