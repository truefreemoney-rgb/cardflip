import { createClient } from "@libsql/client";
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const r = await db.execute({ sql: "SELECT value, updated_at FROM settings WHERE key = 'board'", args: [] });
const row = r.rows[0];
const sections = JSON.parse(row.value);
console.log("updatedAt", row.updated_at);
for (const s of sections) {
  console.log(`\n## ${s.title} (${s.items.length})`);
  for (const it of s.items) console.log(`- [${it.done ? "x" : " "}] ${it.owner ? "(" + it.owner + ") " : ""}${it.text.replace(/\n/g, "\n    ")}`);
}
