// Read-only: average views per post by site and window (reach trial review).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = await c.execute("SELECT site, at, views, likes, kind FROM social_posts WHERE site IN ('instagram','threads','x','tiktok','bluesky','facebook')");
const win = (iso) => { const d = String(iso).slice(0, 10); return d < "2026-09-26" ? null : d <= "2026-10-09" ? "base 09-26..10-09" : d <= "2026-10-16" ? "trial 10-10..10-16" : "after 10-17.."; };
const agg = {};
for (const row of r.rows) {
  const w = win(row.at); if (!w) continue;
  const k = `${row.site} | ${w}`;
  agg[k] ??= { n: 0, withViews: 0, views: 0, likes: 0 };
  agg[k].n++; agg[k].likes += Number(row.likes ?? 0);
  if (row.views != null) { agg[k].withViews++; agg[k].views += Number(row.views); }
}
for (const k of Object.keys(agg).sort()) { const a = agg[k]; console.log(k.padEnd(36), "posts", String(a.n).padStart(3), "avg views", a.withViews ? (a.views / a.withViews).toFixed(1).padStart(6) : "   n/a", "avg likes", (a.likes / a.n).toFixed(2)); }
