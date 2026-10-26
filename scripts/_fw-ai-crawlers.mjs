// Add named crawlers that send no visitors to the "AI crawlers" deny rule (crawler policy 10-19). Idempotent: the rule is
// found by its "AI crawlers:" prefix and its user-agent regex only grows. 10-26: Reflectionbot (reflection.ai, ~3.9K card
// pages a day from Google Cloud), ElevenlabsCrawler (~280 Yu-Gi-Oh pages from four hosting networks), Lightpanda
// (headless scraping browser), KeenableBot (AI-agent search index). Add each to TRAINING_BOTS in src/app/robots.ts too.
//   node scripts/_fw-ai-crawlers.mjs <BotName> [BotName...]
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, "").replace(/^ï»¿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config", qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const names = process.argv.slice(2);
if (!names.length || names.some((n) => !/^[A-Za-z0-9._-]+$/.test(n))) throw new Error("usage: node scripts/_fw-ai-crawlers.mjs <BotName> [BotName...]");
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const old = active.rules.find((r) => r.name.startsWith("AI crawlers:"));
if (!old) throw new Error("AI crawlers rule not found");
const ua = old.conditionGroup[0].conditions.find((c) => c.type === "user_agent");
if (!ua) throw new Error("no user_agent condition in group 0");
const have = new Set(ua.value.split("|").map((s) => s.toLowerCase()));
for (const n of names) if (!have.has(n.toLowerCase())) ua.value = `${ua.value}|${n}`;
const value = {
  name: "AI crawlers: named bots that send no visitors + Meta ASN 398781 (deny)",
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
