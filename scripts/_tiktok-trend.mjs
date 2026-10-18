import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await c.execute("SELECT at, views, likes, shares, kind, slot, format, read_at, substr(text,1,40) t FROM social_posts WHERE site='tiktok' AND at >= '2026-09-25' ORDER BY at")).rows;
const now = Date.now();
for (const r of rows) {
  const ageH = ((Number(r.read_at) - Date.parse(r.at)) / 36e5).toFixed(0);
  const etHour = new Date(Date.parse(r.at) - 4 * 36e5).toISOString().slice(5, 16).replace("T", " ");
  console.log(etHour, "ET", String(r.views).padStart(5), "v", String(r.likes).padStart(3), "l", (r.kind || "-").padEnd(8), (r.slot || "-").padEnd(8), (r.format || "-").padEnd(8), "readAge", ageH + "h", "|", String(r.t).replace(/\n/g, " "));
}
