// READ ONLY (prod): reach-trial verdict (2c23d2a4: sign-off moved to the END of Instagram/Threads/X posts from 10-09).
// Median views/likes per post by period, posts older than 48 h only (views still climbing before that).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const sites = (await c.execute("SELECT site, COUNT(*) n, MIN(at) a, MAX(at) b FROM social_posts GROUP BY site")).rows;
console.log(sites.map((r) => `${r.site}:${r.n} (${String(r.a).slice(0, 10)}..${String(r.b).slice(0, 10)})`).join(" | "));
const cutoff = new Date(Date.now() - 48 * 3600e3).toISOString();
const period = (at) => (at < "2026-10-02" ? null : at < "2026-10-09" ? "before 10-02..08" : at < "2026-10-17" ? "TRIAL 10-09..16" : "after 10-17..");
const med = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : "-"; };
for (const site of sites.map((r) => String(r.site)).filter((s) => (process.argv[2] ? new RegExp(process.argv[2], "i") : /insta|thread|^x$|twitter/i).test(s))) {
  const rows = (await c.execute({ sql: "SELECT at, views, likes, comments, shares FROM social_posts WHERE site = ? AND at < ? ORDER BY at", args: [site, cutoff] })).rows;
  const g = {};
  for (const r of rows) { const p = period(String(r.at)); if (!p) continue; (g[p] ??= []).push(r); }
  for (const p of ["before 10-02..08", "TRIAL 10-09..16", "after 10-17.."]) {
    const a = g[p] ?? [];
    console.log(`${site.padEnd(10)} ${p.padEnd(17)} posts ${String(a.length).padStart(3)} | median views ${med(a.map((r) => r.views))} | likes ${med(a.map((r) => r.likes))} | mean views ${a.length ? Math.round(a.reduce((s, r) => s + Number(r.views ?? 0), 0) / a.length) : "-"}`);
  }
}
