import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
for (const slot of ["morning", "midday", "evening"]) {
  const r = (await c.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [`social_tiktok:${slot}:2026-10-18`] })).rows[0];
  if (!r) { console.log(slot, "none"); continue; }
  const v = JSON.parse(String(r.value));
  console.log(slot, v.title, JSON.stringify((v.cards ?? []).map((x) => [x.game ?? v.game, x.cardId, x.variant ?? "normal", x.to])));
}
const m = (await c.execute("SELECT value FROM settings WHERE key = 'post_check:2026-10-18'")).rows[0];
console.log("marks", m ? m.value : "none");
