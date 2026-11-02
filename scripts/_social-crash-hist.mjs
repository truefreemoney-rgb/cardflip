import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await db.execute("SELECT site, slot, at FROM social_posts WHERE site IN ('bluesky','x','facebook','threads','instagram') AND at >= '2026-10-20' ORDER BY at")).rows;
const by = {};
for (const r of rows) { const d = new Date(String(r.at).replace(/\+0000$/, "Z")); const k = d.toLocaleDateString("en-US", { timeZone: "America/New_York" }) + " " + r.slot; (by[k] ||= {})[r.site] = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" }); }
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(22), ["bluesky","x","facebook","threads","instagram"].map((s) => s.slice(0,2) + " " + (v[s] ?? "-")).join("  "));
const pend = (await db.execute("SELECT site, day, slot, url FROM social_post_log WHERE url LIKE 'pending:%' ORDER BY day")).rows;
console.log("pending rows:"); for (const r of pend) console.log(" ", r.day, r.slot, r.site, r.url);
