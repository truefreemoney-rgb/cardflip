import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const checked = new Set((await c.execute("SELECT game || '|' || card_id || '|' || variant k FROM price_checked WHERE off_day IS NULL")).rows.map((r) => r.k));
for (const v of ["check", "high"]) {
  const rows = (await c.execute({ sql: "SELECT game, card_id, variant FROM ebay_asks WHERE verdict = ? AND manual IS NULL", args: [v] })).rows;
  const open = rows.filter((r) => !checked.has(`${r.game}|${r.card_id}|${r.variant}`));
  const by = {};
  for (const r of open) by[r.game] = (by[r.game] ?? 0) + 1;
  console.log(v, open.length, JSON.stringify(by));
}
