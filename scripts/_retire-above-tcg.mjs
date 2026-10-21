// PROD WRITE (Chris 10-21 ~8:15pm ET "1. yes do it"): retire every active eBay check that holds a price >25% ABOVE
// TCGplayer (slab-polluted title-filter searches, "STOP LOOKING AT SLABS"). Backup first; --go to write.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await c.execute("SELECT * FROM price_checked WHERE off_day IS NULL AND tcg_usd > 0 AND usd > tcg_usd * 1.25 ORDER BY usd DESC")).rows;
for (const r of rows) console.log(`${r.game} ${r.card_id} ${r.variant}: check $${r.usd} (n ${r.n}, ${r.day}) vs TCGplayer $${r.tcg_usd} (${r.tcg_day}) | ${String(r.note).slice(0, 60)}`);
if (!process.argv.includes("--go")) process.exit(0);
fs.writeFileSync(`.retired-checks-${Date.now()}.json`, JSON.stringify(rows, null, 1));
let n = 0;
for (const r of rows) n += (await c.execute({ sql: "UPDATE price_checked SET off_day = ? WHERE game = ? AND card_id = ? AND variant = ? AND off_day IS NULL", args: ["2026-10-21", r.game, r.card_id, r.variant] })).rowsAffected;
console.log("retired", n);
