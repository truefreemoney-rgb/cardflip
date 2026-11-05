// READ ONLY: board size by section (the 200 KB cap stops new board notes).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = (await db.execute("SELECT value, updated_at FROM settings WHERE key LIKE 'board%'")).rows;
for (const row of r) {
  const v = String(row.value);
  console.log("total", v.length, "updated", new Date(Number(row.updated_at)).toLocaleString("en-US", { timeZone: "America/New_York" }));
  let secs; try { secs = JSON.parse(v); } catch { console.log("not json"); continue; }
  if (!Array.isArray(secs)) continue;
  for (const s of secs) console.log(String(JSON.stringify(s).length).padStart(7), String(s.items?.length ?? 0).padStart(5), "items |", s.title);
}
