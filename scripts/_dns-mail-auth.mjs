// 10-31 (Chris "fix what you need to fix"): iCloud sign-ups never confirmed (0 of 2); cardflip.io had no DMARC and
// SPF ended "?all". Adds _dmarc (p=none, reports to support@) and sets SPF to "~all" in Vercel DNS.
// Dry run by default (prints the TXT records); --apply writes.   node scripts/_dns-mail-auth.mjs [--apply]
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const TEAM = "team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const apply = process.argv.includes("--apply");
const DMARC = "v=DMARC1; p=none; rua=mailto:support@cardflip.io";
const SPF = "v=spf1 include:spf.messagingengine.com ~all";

const res = await fetch(`https://api.vercel.com/v4/domains/cardflip.io/records?teamId=${TEAM}&limit=100`, { headers });
if (!res.ok) throw new Error(`list ${res.status} ${await res.text()}`);
const { records } = await res.json();
const txt = records.filter((r) => r.type === "TXT");
for (const r of txt) console.log(`TXT ${r.name || "@"} = ${String(r.value).slice(0, 90)} (id ${r.id})`);
const spf = txt.filter((r) => (r.name === "" || r.name === "@") && /^v=spf1/i.test(r.value));
const dmarc = txt.filter((r) => r.name === "_dmarc");
if (spf.length !== 1) throw new Error(`expected 1 SPF record, found ${spf.length}: stop`);
console.log(`SPF now: ${spf[0].value}\nDMARC now: ${dmarc.map((r) => r.value).join(" | ") || "(none)"}`);
if (!apply) {
  console.log("dry run (add --apply)");
  process.exit(0);
}
if (spf[0].value !== SPF) {
  const p = await fetch(`https://api.vercel.com/v1/domains/records/${spf[0].id}?teamId=${TEAM}`, { method: "PATCH", headers, body: JSON.stringify({ value: SPF }) });
  console.log("SPF update:", p.status, p.ok ? "ok" : await p.text());
}
if (dmarc.length === 0) {
  const p = await fetch(`https://api.vercel.com/v2/domains/cardflip.io/records?teamId=${TEAM}`, { method: "POST", headers, body: JSON.stringify({ name: "_dmarc", type: "TXT", value: DMARC, ttl: 3600 }) });
  console.log("DMARC add:", p.status, p.ok ? "ok" : await p.text());
}
