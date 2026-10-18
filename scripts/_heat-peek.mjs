// Prod heat rows: list them; `--drop-tab <id>` deletes one tab's views + taps (my own test visits only).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const tapCols = (await c.execute("PRAGMA table_info(heat_taps)")).rows.map((r) => r.name);
console.log("heat_taps columns:", tapCols.join(","));
const drop = process.argv.indexOf("--drop-tab");
if (drop > 0) {
  const tab = process.argv[drop + 1];
  const v = await c.execute({ sql: "DELETE FROM heat_views WHERE tab = ?", args: [tab] });
  const t = tapCols.includes("tab") ? await c.execute({ sql: "DELETE FROM heat_taps WHERE tab = ?", args: [tab] }) : { rowsAffected: "n/a" };
  console.log("deleted views", v.rowsAffected, "taps", t.rowsAffected);
}
const v = await c.execute("SELECT * FROM heat_views ORDER BY at LIMIT 40");
for (const r of v.rows) console.log(JSON.stringify(r));
console.log("taps", (await c.execute("SELECT COUNT(*) AS n FROM heat_taps")).rows[0].n);
