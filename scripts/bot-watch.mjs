// Hourly bot watch (Chris 10-21 ~2pm ET: "implement something right now so this dosnt happen anymore"). Scrapers walk
// card pages from rented proxy pools under fake browser names, and every new page they open is an ISR write on the bill
// (10-19 Meta 65K, 10-20 Meta via Oculus 29.6K, 10-21 a Wave Broadband proxy pool 19K). Before this, Chris found each
// one on the Vercel bill first. This reads the last 4 hours of ALLOWED traffic from the firewall's own metrics and
// denies any (network, TLS fingerprint) pair that is clearly a crawler:
//   - over MIN_REQ requests in the window,
//   - spread over MIN_IPS+ addresses (a proxy pool, not one person or one of our own scripts),
//   - mostly card pages (a crawl, not people loading the app), OR almost only card pictures with no app code and no
//     /api/ calls at all (10-26: an Amazon AWS scraper pulled ~70K pictures in 45 min and was "0% card pages"; a real
//     browser always loads /_next/ code or calls /api/, so real customers never look like this),
//   - not a network we must never block (search engines, link previews, iCloud Private Relay, eBay/Stripe webhooks).
//     Amazon, Google Cloud and Microsoft Azure are blocked by pair too unless the pair's top user agent is an allowed bot
//     (PerplexityBot, OAI-SearchBot, bingbot...): 10-26 the "Amazon = too broad, alert only" rule let that scraper run.
// Blocks go into ONE rule, network AND fingerprint per group, so real customers on the same ISP keep access
// (same shape as scripts/_fw-block-ja4.mjs). Every block or held suspect mails Chris via /api/ops/alert.
// First wall since 10-26: scripts/_fw-cloud-challenge.mjs makes every cloud/hosting network pass a browser check;
// this catches what gets past it (residential proxy pools, allowed-bot names used by someone else).
//   node scripts/bot-watch.mjs [--dry]      (VERCEL_TOKEN + OPS_KEY from env, or .env.migration.json locally)
import fs from "node:fs";

const TEAM = "team_l73XXJDNrLnYFezMhk8bn2K2";
const PRJ = "prj_GlXQxal5IAh2oG0zls2ZGjhK212b";
const RULE = "Scrapers: auto-blocked by bot watch (deny)";
const HOURS = 4;
const MIN_REQ = 1000;
const MIN_IPS = 25;
const MIN_CARDS_SHARE = 0.6;
const MIN_PICS_SHARE = 0.8;
const MAX_APP_SHARE = 0.01; // /_next/ code + /api/ calls: a real browser always makes some
const MAX_GROUPS = 40;
const MAX_NEW_PER_RUN = 3;
// Alert only, never auto-block: Google's own network (Googlebot, Gmail pictures, AdsBot), Apple (Applebot + Private
// Relay), Meta (link previews), Cloudflare/Akamai/Fastly (iCloud Private Relay), eBay + Stripe (webhooks).
const NEVER = new Set(["15169", "36040", "714", "6185", "32934", "13335", "20940", "16625", "54113", "11643", "5091"]);
// Clouds where allowed bots live next to scrapers: block the pair unless its top user agent is an allowed bot.
const BIG_CLOUDS = new Set(["16509", "14618", "8987", "396982", "8075"]);
const ALLOWED_BOTS = /PerplexityBot|Perplexity-User|Claude-SearchBot|Claude-User|DuckDuckBot|DuckAssistBot|Twitterbot|Slackbot|Discordbot|TelegramBot|WhatsApp|Snapchat|LinkedInBot|Pinterest|redditbot|Iframely|Embedly|Mastodon|Cardyb|Qwantbot|SeznamBot|Googlebot|AdsBot-Google|Mediapartners-Google|Google-InspectionTool|APIs-Google|GoogleOther|FeedFetcher-Google|Google-Read-Aloud|Storebot-Google|GoogleImageProxy|bingbot|BingPreview|msnbot|adidxbot|MicrosoftPreview|OAI-SearchBot|ChatGPT-User|^CardFlip\/1\.0|^cardflip-(uptime|smoke)$|^vercel-/i;

const dry = process.argv.includes("--dry");
const local = fs.existsSync(".env.migration.json") ? JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, "")) : {};
const token = process.env.VERCEL_TOKEN || local.vercelToken;
const opsKey = process.env.OPS_KEY;
if (!token) throw new Error("VERCEL_TOKEN missing");
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const end = new Date(Math.ceil(Date.now() / 3600e3) * 3600e3);
const start = new Date(end.getTime() - HOURS * 3600e3);
const et = (d) => d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";

async function metric(filter, groupBy, limit) {
  const body = {
    metrics: { value: { metric: "vercel.firewall_action.count", aggregation: "count" } },
    outputs: ["value"], filter, groupBy, bucketSeconds: HOURS * 3600,
    seriesSelection: { limit, mode: "exact", rankBy: [{ metric: "value", direction: "desc" }] },
    scope: { ownerId: TEAM, projectIds: [PRJ] },
    timeRange: { start: start.toISOString(), end: end.toISOString() },
  };
  const r = await fetch(`https://api.vercel.com/observability-api/v1/metrics?teamId=${TEAM}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`metrics ${r.status} ${(await r.text()).slice(0, 200)}`);
  const totals = new Map();
  for (const s of (await r.json()).series ?? []) {
    const key = groupBy.map((g) => s.dimensions[g] ?? "").join("\t");
    totals.set(key, (totals.get(key) ?? 0) + s.values.value);
  }
  return [...totals].sort((a, b) => b[1] - a[1]);
}

async function alert(message, outcome = "failed") {
  console.log("ALERT:", message);
  if (dry || !opsKey) return;
  const url = process.env.RUN_URL;
  const r = await fetch("https://cardflip.io/api/ops/alert", {
    method: "POST", headers: { Authorization: `Bearer ${opsKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ workflow: "Bot Watch", url, message: message.slice(0, 500), outcome }),
  });
  console.log("alert", r.status);
}

const pairs = await metric("wafAction:allow", ["asnId", "asnName", "clientJa4Digest"], 30);
console.log(`allowed ${et(start)} - ${et(end)}, top pairs:`);
for (const [k, v] of pairs.slice(0, 8)) console.log(`  ${v}\t${k}`);

const suspects = [];
for (const [key, count] of pairs) {
  if (count < MIN_REQ) break;
  const [asn, asnName, ja4] = key.split("\t");
  if (!asn || !ja4) continue;
  const f = `wafAction:allow AND asnId:"${asn}" AND clientJa4Digest:"${ja4}"`;
  const ips = (await metric(f, ["clientIp"], 500)).length;
  const paths = await metric(f, ["requestPath"], 500);
  const seen = paths.reduce((n, [, v]) => n + v, 0);
  const sum = (pre) => paths.filter(([p]) => pre.some((x) => p.startsWith(x))).reduce((n, [, v]) => n + v, 0);
  const share = seen ? sum(["/cards/"]) / seen : 0;
  const pics = seen ? sum(["/pics/"]) / seen : 0;
  const app = seen ? sum(["/_next/", "/api/"]) / seen : 0;
  const crawl = ips >= MIN_IPS && (share >= MIN_CARDS_SHARE || (pics >= MIN_PICS_SHARE && app < MAX_APP_SHARE));
  console.log(`  check ${asnName} AS${asn} ${ja4}: ${count} req, ${ips}${ips === 500 ? "+" : ""} IPs, ${Math.round(share * 100)}% card pages, ${Math.round(pics * 100)}% pictures, ${Math.round(app * 100)}% app -> ${crawl ? "CRAWLER" : "ok"}`);
  if (!crawl) continue;
  const ua = BIG_CLOUDS.has(asn) ? ((await metric(f, ["userAgent"], 5))[0]?.[0] ?? "") : "";
  suspects.push({ asn, asnName, ja4, count, ips, share, pics, ua, allowedBot: ALLOWED_BOTS.test(ua) });
}
if (!suspects.length) { console.log("no crawler found"); process.exit(0); }

const cfgUrl = `https://api.vercel.com/v1/security/firewall/config?projectId=${PRJ}&teamId=${TEAM}`;
const active = await (await fetch(`https://api.vercel.com/v1/security/firewall/config/active?projectId=${PRJ}&teamId=${TEAM}`, { headers: auth })).json();
const old = (active.rules ?? []).find((r) => r.name === RULE);
const groups = old ? old.conditionGroup : [];
// Already denied by ANY active rule (e.g. a hand rule from scripts/_fw-block-ja4.mjs): the window still holds its traffic
// from before the block, so skip it instead of a duplicate group and a second mail.
const allGroups = (active.rules ?? []).filter((r) => r.active && r.action?.mitigate?.action === "deny").flatMap((r) => r.conditionGroup ?? []);
const has = (s) => allGroups.some((g) => g.conditions.some((c) => c.type === "geo_as_number" && c.value === s.asn) && g.conditions.some((c) => c.type === "ja4_digest" && [].concat(c.value).includes(s.ja4)));
const line = (s) => `${s.asnName} (AS${s.asn}) fingerprint ${s.ja4}: ${s.count} requests in ${HOURS} h from ${s.ips}${s.ips === 500 ? "+" : ""} addresses, ${Math.round(s.share * 100)}% card pages, ${Math.round(s.pics * 100)}% pictures${s.ua ? `, top agent "${s.ua.slice(0, 80)}"` : ""}`;

const protectedPair = (s) => NEVER.has(s.asn) || (BIG_CLOUDS.has(s.asn) && s.allowedBot);
const held = suspects.filter(protectedPair);
const fresh = suspects.filter((s) => !protectedPair(s) && !has(s));
const toBlock = fresh.slice(0, Math.max(0, Math.min(MAX_NEW_PER_RUN, MAX_GROUPS - groups.length)));
const overflow = fresh.slice(toBlock.length);

if (toBlock.length) {
  const value = {
    name: RULE,
    description: "Proxy-pool crawlers found by scripts/bot-watch.mjs; network AND fingerprint.",
    active: true,
    conditionGroup: [...groups, ...toBlock.map((s) => ({ conditions: [
      { type: "geo_as_number", op: "eq", value: s.asn },
      { type: "ja4_digest", op: "inc", value: [s.ja4] },
    ] }))],
    action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
  };
  const body = old ? { action: "rules.update", id: old.id, value } : { action: "rules.insert", id: null, value };
  if (dry) console.log("DRY: would", body.action, toBlock.map((s) => `AS${s.asn}/${s.ja4}`).join(", "));
  else {
    const r = await fetch(cfgUrl, { method: "PATCH", headers: auth, body: JSON.stringify(body) });
    const text = await r.text();
    console.log(body.action, r.status, text.slice(0, 200));
    if (!r.ok) { await alert(`Bot watch found a crawler but the firewall update FAILED (${r.status}): ${toBlock.map(line).join("; ")}`); process.exit(1); }
  }
}
const parts = [];
if (toBlock.length) parts.push(`Blocked: ${toBlock.map(line).join("; ")}.`);
if (held.length) parts.push(`NOT blocked (protected network, check by hand): ${held.map(line).join("; ")}.`);
if (overflow.length) parts.push(`NOT blocked (per-run or rule cap): ${overflow.map(line).join("; ")}.`);
// A clean block is good news; anything left unblocked still reads as a failure that needs a hand.
if (parts.length) await alert(parts.join(" "), held.length || overflow.length ? "failed" : "handled");
else console.log("crawlers already blocked:", suspects.map((s) => `AS${s.asn}`).join(", "));
