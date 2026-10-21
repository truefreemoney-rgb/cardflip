import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await c.execute({ sql: "SELECT at FROM signup_log WHERE at > ?", args: [Date.now() - 60 * 86400_000] })).rows.map((r) => Number(r.at));
const hours = new Map();
for (const t of rows) { const h = Math.floor(t / 3600_000); hours.set(h, (hours.get(h) ?? 0) + 1); }
const bot = (h) => { const t = h * 3600_000; return (t >= Date.parse("2026-10-21T02:00:00Z") && t < Date.parse("2026-10-21T06:00:00Z")); };
const normal = [...hours].filter(([h]) => !bot(h)).map(([, n]) => n).sort((a, b) => b - a);
console.log("sign-ups last 60 days:", rows.length, "| busiest normal hours:", normal.slice(0, 10).join(","), "| hours with any:", normal.length);
const days = new Map(); for (const t of rows) { const d = new Date(t).toISOString().slice(0, 10); days.set(d, (days.get(d) ?? 0) + 1); }
console.log("busiest days:", [...days].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, n]) => `${d}:${n}`).join(" "));
for (const [h, n] of [...hours].filter(([h]) => bot(h))) console.log("bot hour", new Date(h * 3600_000).toISOString(), n);
