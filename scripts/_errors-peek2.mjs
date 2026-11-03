import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const since = Date.now() - 11.5 * 3600 * 1000;
const et = (ms) => new Date(Number(ms)).toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit" });
const g = (await db.execute({ sql: "SELECT source, substr(message,1,160) m, digest, COUNT(*) n, MIN(at) a, MAX(at) b FROM error_events WHERE at >= ? GROUP BY 1,2,3 ORDER BY b DESC", args: [since] })).rows;
for (const r of g) console.log(`${r.n}x  ${et(r.a)} .. ${et(r.b)}  [${r.source}] ${r.m} ${r.digest ?? ""}`);
if (!g.length) console.log("no error_events in 36h");
