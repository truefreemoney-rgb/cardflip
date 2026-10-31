// 10-31: Instagram visitors today (ET day), what they did, where they stopped before signup. Prod SELECT only.
//   node scripts/_ig-today.mjs [day]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^ï»¿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const day = process.argv[2] ?? "2026-10-31";
const et = (ms) => new Date(Number(ms)).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
const tally = (arr) => [...arr.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);

const IG = `(src = 'instagram' OR ref LIKE '%instagram%' OR camp LIKE 'ig%')`;
const igVisitors = (await q(`SELECT DISTINCT visitor FROM page_views WHERE day = ? AND ${IG}`, [day])).map((r) => r.visitor);
console.log(`${day}: Instagram visitors ${igVisitors.length}`);
if (!igVisitors.length) process.exit(0);
const ph = igVisitors.map(() => "?").join(",");
const views = await q(`SELECT visitor, path, at, ref, device, country, src, camp FROM page_views WHERE day = ? AND visitor IN (${ph}) ORDER BY visitor, at`, [day, ...igVisitors]);

const byV = new Map();
for (const v of views) (byV.get(v.visitor) ?? byV.set(v.visitor, []).get(v.visitor)).push(v);
const first = [...byV.values()].map((l) => l[0]);
console.log("campaign:", tally(first.map((f) => f.camp ?? "-")));
console.log("ref:", tally(first.map((f) => f.ref ?? "-")));
console.log("device:", tally(first.map((f) => f.device ?? "-")));
console.log("country:", tally(first.map((f) => f.country ?? "-")));
console.log("landing:", tally(first.map((f) => f.path)));
console.log("hour ET:", tally(first.map((f) => et(f.at).replace(/:\d\d:\d\d/, ""))));
console.log("pages per visitor:", tally([...byV.values()].map((l) => l.length)));

// Funnel: reached each step at any point today.
const reached = (re) => [...byV.values()].filter((l) => l.some((v) => re.test(v.path))).length;
console.log("funnel (visitors who reached):", {
  landed: byV.size,
  anySecondPage: [...byV.values()].filter((l) => new Set(l.map((v) => v.path)).size > 1).length,
  scanPage: reached(/^\/scan/),
  signupPage: reached(/^\/(signup|register|join)/),
  loginPage: reached(/^\/login/),
  pricing: reached(/^\/pricing/),
  appPages: reached(/^\/app/),
  cardPages: reached(/^\/(cards?|catalog|pokemon|magic|lorcana|one-piece|yugioh)\//),
});
console.log("all paths seen:", tally(views.map((v) => v.path.replace(/\/[^/]{12,}$/, "/:id"))).slice(0, 25));

// Repeat / odd visitors: many hits, very fast hits, same second.
for (const [vis, l] of byV) {
  const span = (Number(l.at(-1).at) - Number(l[0].at)) / 1000;
  if (l.length >= 4 || (l.length >= 2 && span < 2)) console.log("  busy/fast:", vis.slice(0, 8), l.length, "views in", span.toFixed(1), "s:", l.map((v) => `${et(v.at)} ${v.path}`).join(" | "));
}

const signups = await q(`SELECT user_id, at, country, src, medium, campaign, landing, ref_host FROM signup_log WHERE at >= ? ORDER BY at`, [Date.parse(`${day}T04:00:00Z`)]);
console.log(`signups today (all sources): ${signups.length}`);
for (const s of signups) console.log("  ", et(s.at), s.src, s.medium, s.campaign, s.landing, s.ref_host, s.country);

// Scroll depth on the landing page today (heat_views has no visitor; phone + "/" only, all sources).
const depth = await q(`SELECT depth, COUNT(*) n FROM heat_views WHERE day = ? AND path = '/' GROUP BY depth ORDER BY depth`, [day]).catch((e) => [{ depth: "err", n: e.message }]);
console.log("home scroll depth today (all sources):", depth.map((r) => `${r.depth}:${r.n}`).join(" "));
const taps = await q(`SELECT label, COUNT(*) n FROM heat_taps WHERE at >= ? AND page = '/' AND label IS NOT NULL AND label <> '' GROUP BY label ORDER BY n DESC LIMIT 15`, [Date.parse(`${day}T04:00:00Z`)]);
console.log("home taps today (all sources):", taps.map((r) => `${r.label}:${r.n}`).join(" | "));
db.close();
