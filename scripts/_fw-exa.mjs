// Add ExaSearchBot to the "AI crawlers" deny rule (Chris 10-22 "up to you" on ~1.1K card pages a day: it feeds Exa's AI
// search index, sends no visitors, costs ISR writes). Idempotent: the rule is updated by name, the regex just grows.
//   node scripts/_fw-exa.mjs
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config", qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const old = active.rules.find((r) => r.name.startsWith("AI crawlers:"));
if (!old) throw new Error("AI crawlers rule not found");
const ua = old.conditionGroup[0].conditions.find((c) => c.type === "user_agent");
if (!ua) throw new Error("no user_agent condition in group 0");
if (!/ExaSearchBot/.test(ua.value)) ua.value = `${ua.value}|ExaSearchBot`;
const value = {
  name: "AI crawlers: meta-webindexer, AionBot, Amzn-SearchBot, ExaSearchBot, Meta ASN 398781 (deny)",
  description: old.description ?? "",
  active: true,
  conditionGroup: old.conditionGroup,
  action: old.action,
};
const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify({ action: "rules.update", id: old.id, value }) });
console.log("update", r.status, (await r.text()).slice(0, 200));
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const now = after.rules.find((x) => x.id === old.id);
console.log("version", after.version, "|", now.name, "|", JSON.stringify(now.conditionGroup[0].conditions));
