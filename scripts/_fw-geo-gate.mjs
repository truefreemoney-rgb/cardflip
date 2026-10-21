// Country gate at the Firewall (Chris 10-21 ~3:30pm ET: "only approved english countries", "these other countries
// have no business even being here honestly"). The app's own gate (src/proxy.ts) already shows /unavailable, but a
// visitor still reaches our functions to be told so, and anything calling itself a crawler is let through. This
// denies at the edge everyone outside lib/countries.ts DEFAULT_ALLOWED_COUNTRIES, except: the machine paths the
// proxy exempts (webhooks, crons, GitHub Actions), our smoke checks (x-cf-smoke, copied from the cloud-servers
// rule), Google + Apple crawlers by network, and members carrying the cf_home travel pass (the app still verifies
// its signature). 22 h before: 5,582 allowed from other countries = Leaseweb SG scraper, Tor relays, proxy pools.
//   node scripts/_fw-geo-gate.mjs [--dry]
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const NAME = "Countries: only US, CA, GB, IE, AU, NZ (deny)";
const COUNTRIES = ["US", "CA", "GB", "IE", "AU", "NZ"]; // = DEFAULT_ALLOWED_COUNTRIES
const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const smoke = (active.rules ?? []).flatMap((r) => r.conditionGroup.flatMap((g) => g.conditions)).find((c) => c.type === "header" && c.key === "x-cf-smoke");
if (!smoke) throw new Error("x-cf-smoke condition not found in the active rules");
const value = {
  name: NAME,
  description: "Outside the open countries: denied at the edge (10-21). Webhooks, smoke, Google/Apple, travel pass exempt.",
  active: true,
  conditionGroup: [{ conditions: [
    { type: "geo_country", op: "inc", neg: true, value: COUNTRIES },
    { type: "path", op: "re", neg: true, value: "^/api/(cron/|stripe/webhook|ebay/(account-deletion|callback)|social/|ops/|runner/|digest/unsubscribe)" },
    { type: "geo_as_number", op: "inc", neg: true, value: ["15169", "396982", "714", "6185"] },
    { type: "cookie", key: "cf_home", op: "ex", neg: true },
    { ...smoke },
  ] }],
  action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
};
const old = (active.rules ?? []).find((r) => r.name === NAME);
const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
if (process.argv.includes("--dry")) { console.log(JSON.stringify(body, null, 1)); process.exit(0); }
const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
console.log(body.action, r.status, (await r.text()).slice(0, 300));
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
const mine = (after.rules ?? []).find((x) => x.name === NAME);
console.log(mine ? `${mine.name} | active ${mine.active} | ${mine.action?.mitigate?.action} | ${JSON.stringify(mine.conditionGroup).replace(/"value":"[0-9a-f]{20,}"/, '"value":"<smoke key>"')}` : "RULE NOT FOUND");
