// Cloud + hosting networks must pass Vercel's browser check (challenge), except the allowed list (10-26).
// Chris 10-26 3:33pm ET, after an Amazon AWS scraper pulled ~70K card pictures in 45 min under "probe-image-size" and a
// fake Chrome/124 name: "exclude the allowed list, this issue has to stop immediately". Scripts on rented servers can't
// solve the JavaScript check; a real person on a VPN or cloud browser solves it once and browses on. Allowed bots skip it,
// each only from its real home network (a "Googlebot" on AWS gets the check), and so do our own tools and machine paths.
//   node scripts/_fw-cloud-challenge.mjs --check   (registry names for every ASN, no changes)
//   node scripts/_fw-cloud-challenge.mjs --dry     (print the rule, no changes)
//   node scripts/_fw-cloud-challenge.mjs           (insert, or update the rule of the same name)
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, "").replace(/^ï»¿/, ""));
const base = "https://api.vercel.com/v1/security/firewall/config";
const qs = "projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&teamId=team_l73XXJDNrLnYFezMhk8bn2K2";
const headers = { Authorization: `Bearer ${m.vercelToken}`, "Content-Type": "application/json" };
const NAME = "Scrapers: cloud + hosting networks need a browser check (challenge)";

const AWS = ["16509", "14618", "8987"];
const GOOGLE_CLOUD = ["396982"]; // Google's own 15169 / 36040 (Googlebot, Gmail images, AdsBot) are never listed
const AZURE = ["8075"];
const HOSTING = [
  "31898", // Oracle Cloud
  "45102", "37963", // Alibaba Cloud
  "132203", "45090", // Tencent Cloud
  "136907", "55990", // Huawei Cloud
  "14061", // DigitalOcean
  "63949", // Linode (Akamai Connected Cloud, not Akamai's CDN / iCloud Private Relay)
  "20473", // Vultr (The Constant Company)
  "16276", "35540", // OVH
  "24940", "213230", "212317", // Hetzner
  "51167", "40021", "141995", // Contabo
  "12876", // Scaleway
  "60781", "16265", "28753", "30633", "27411", "59253", "7203", "133752", // Leaseweb
  "8560", // IONOS
  "47583", // Hostinger
  "36007", // Kamatera
  "54290", // Hostwinds
  "59642", // Cherry Servers
  "199524", // G-Core Labs
  "21859", // Zenlayer
  "40676", // Psychz
  "36352", // ColoCrossing (HostPapa); NOT 8100 = Splice Internet, an Australian ISP (RIPEstat 10-26)
  "63023", // GTHost
  "62240", // Clouvider
  "7979", // Servers.com
  "396356", // Latitude.sh
  "64286", // LogicWeb
  "62874", // Web2Objects
  "30058", // FDCservers
  "18779", // EGIHosting
  "135377", // UCLOUD
  "396319", // Oxylabs (proxy company)
  "203020", "207990", // HostRoyale
  "212238", "60068", // Datacamp / CDN77
  "9009", // M247
  "19318", // Interserver
  "46844", // Sharktech
  "23470", // ReliableSite
  "29802", // Hivelocity
  "19969", // Joe's Datacenter
  "35913", // DediPath
  "11878", // Tzulo
  "20278", // Nexeon
  "197540", // netcup
  "40509", // Fly.io
  "54825", // Equinix Metal
  "33070", "27357", "19994", // Rackspace
];

// Bots and tools that skip the check. Vercel's "re" is case-insensitive.
const COMMON = [
  "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "DuckDuckBot", "DuckAssistBot",
  "Twitterbot", "Slackbot", "Discordbot", "TelegramBot", "WhatsApp", "Snapchat", "LinkedInBot", "Pinterestbot", "Pinterest/",
  "redditbot", "Iframely", "Embedly", "Mastodon", "Cardyb", "Qwantbot", "SeznamBot",
  "^CardFlip/1\\.0", "^cardflip-(uptime|smoke)$", "^vercel-(cron|screenshot|favicon)",
].join("|");
const GOOGLE_BOTS = "Googlebot|AdsBot-Google|Mediapartners-Google|Google-InspectionTool|APIs-Google|GoogleOther|FeedFetcher-Google|Google-Read-Aloud|Google-Site-Verification|Storebot-Google|Google-PageRenderer|GoogleImageProxy|Google-Safety|Chrome-Lighthouse";
const MICROSOFT_BOTS = "bingbot|BingPreview|msnbot|adidxbot|MicrosoftPreview|SkypeUriPreview|OAI-SearchBot|ChatGPT-User";
// Machine paths (same list as the country gate) + robots.txt, .well-known, and the smoke test's bare /admin check.
const EXEMPT_PATHS = "^/(api/(cron/|stripe/webhook|ebay/(account-deletion|callback)|social/|ops/|runner/|digest/unsubscribe)|robots\\.txt$|\\.well-known/|admin$)";

const active = await (await fetch(`${base}/active?${qs}`, { headers })).json();
const smoke = active.rules.find((r) => r.name.startsWith("Countries:")).conditionGroup[0].conditions.find((c) => c.key === "x-cf-smoke").value;
const group = (asns, allowUa) => ({ conditions: [
  { type: "geo_as_number", op: "inc", value: asns },
  { type: "user_agent", op: "re", neg: true, value: allowUa },
  { type: "path", op: "re", neg: true, value: EXEMPT_PATHS },
  { type: "header", key: "x-cf-smoke", op: "eq", neg: true, value: smoke },
] });
const value = {
  name: NAME,
  description: "Rented servers must pass the browser check; allowed bots (from their own networks), our tools, machine paths skip it (10-26).",
  active: true,
  conditionGroup: [group(AWS, COMMON), group(GOOGLE_CLOUD, `${COMMON}|${GOOGLE_BOTS}`), group(AZURE, `${COMMON}|${MICROSOFT_BOTS}`), group(HOSTING, COMMON)],
  action: { mitigate: { action: "challenge", rateLimit: null, redirect: null, actionDuration: null } },
};
for (const g of value.conditionGroup) if (g.conditions[0].value.length > 75) throw new Error("an ASN list is over 75 values");

if (process.argv.includes("--check")) {
  const all = [...AWS, ...GOOGLE_CLOUD, ...AZURE, ...HOSTING];
  if (new Set(all).size !== all.length) throw new Error("duplicate ASN");
  for (const asn of all) {
    const j = await (await fetch(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`)).json();
    console.log(`AS${asn.padEnd(7)} ${j.data?.holder ?? "?"}`);
  }
  process.exit(0);
}
if (process.argv.includes("--dry")) { console.log(JSON.stringify(value, null, 1)); process.exit(0); }
const old = (active.rules ?? []).find((r) => r.name === NAME);
const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
const r = await fetch(`${base}?${qs}`, { method: "PATCH", headers, body: JSON.stringify(body) });
console.log(body.action, r.status, (await r.text()).slice(0, 300));
const after = await (await fetch(`${base}/active?${qs}`, { headers })).json();
console.log("version", after.version);
for (const rule of after.rules ?? []) console.log(`- ${rule.name} | active ${rule.active} | ${rule.action?.mitigate?.action}`);
