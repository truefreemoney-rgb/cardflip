// Scratch: read-only. Counts redemptions for a promo code (default SUNDAY25), with times in ET.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const code = process.argv[2] || "SUNDAY25";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const cols = (await db.execute("PRAGMA table_info(promo_redemptions)")).rows.map((r) => r.name);
console.log("columns:", cols.join(", "));
const rows = (await db.execute({ sql: "SELECT * FROM promo_redemptions WHERE code = ?", args: [code] })).rows;
console.log(code, "redeemed:", rows.length);
const t = cols.find((c) => /_at$/.test(c));
for (const r of rows) console.log(t ? new Date(Number(r[t])).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "");
