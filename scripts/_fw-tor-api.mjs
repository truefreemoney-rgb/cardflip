// Firewall (10-21 ~1am ET, second probing wave: 20 of 22 IPs were Tor exits rotating every few requests, so the per-IP
// limits never added up; plus /api/...%2f paths that crash Next with a 500 and two error rows each).
//   node scripts/_fw-tor-api.mjs <tor-exit-list.txt>   (check.torproject.org/torbulkexitlist, one IP a line)
// Rule 1: Tor exits get no /api/ call (sign-in, sign-up, account, waitlist, scans); pages still load for them.
// Rule 2: an /api/ path with an encoded slash or backslash is refused (no route has one).
// Re-running replaces both rules' contents (refresh the Tor list the same way).
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const listFile = process.argv[2];
if (!listFile) throw new Error("usage: node scripts/_fw-tor-api.mjs <tor-exit-list.txt>");
const tor = [...new Set(fs.readFileSync(listFile, "utf8").split(/\s+/).filter((x) => /^[0-9a-f.:]+$/i.test(x)))];
if (tor.length < 500) throw new Error(`only ${tor.length} Tor IPs in ${listFile}, expected 1000+`);
const deny = { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } };
const rules = [
  {
    name: "Abuse: Tor exits on the API (deny)",
    description: `Tor exit nodes get no /api/ call; pages still load. ${tor.length} IPs from check.torproject.org, 10-21 (second probing wave).`,
    active: true,
    // An ip_address "inc" list takes at most 75 values (a longer one is refused with a misleading "`action` should be
    // equal to constant"), so the list goes in groups of 75; groups are OR'd.
    conditionGroup: Array.from({ length: Math.ceil(tor.length / 75) }, (_, i) => ({
      conditions: [{ type: "path", op: "pre", value: "/api/" }, { type: "ip_address", op: "inc", value: tor.slice(i * 75, i * 75 + 75) }],
    })),
    action: deny,
  },
  {
    name: "Abuse: encoded slash in API paths (deny)",
    description: "/api/...%2f and %5c probes crash the router with a 500 and two error rows each (10-21).",
    active: true,
    // raw_path: "path" is matched decoded, where %2f is already a plain slash.
    conditionGroup: [{ conditions: [{ type: "raw_path", op: "re", value: "^/api/.*%(2[fF]|5[cC])" }] }],
    action: deny,
  },
];
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
for (const value of rules) {
  const old = (active.rules ?? []).find((r) => r.name === value.name);
  const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
  const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  console.log(value.name, body.action, r.status, (await r.text()).slice(0, 400));
}
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
for (const rule of after.rules ?? []) {
  const vals = rule.conditionGroup.flatMap((g) => g.conditions).map((c) => (Array.isArray(c.value) ? `${c.type} ${c.op} [${c.value.length}]` : `${c.type} ${c.op} ${String(c.value).slice(0, 40)}`));
  console.log(`- ${rule.name} | active ${rule.active} | ${rule.action?.mitigate?.action} | ${vals.join(" & ")}`);
}
