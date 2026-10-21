// READ ONLY (prod): admin calls (ebay_asks.manual) whose manual_price is >10% away from the printing's latest stored
// TCGplayer USD price, i.e. calls that no longer bind (TASKS B.8). node scripts/_keeps-unbound.mjs [keep|hide|all]
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const which = process.argv[2] ?? "all";
const asks = (await c.execute(`SELECT card_id, game, variant, price_usd, manual, manual_price, manual_day, day, label FROM ebay_asks WHERE manual IS NOT NULL${which === "all" ? "" : ` AND manual = '${which === "hide" ? "hide" : "keep"}'`}`)).rows;
let unbound = 0;
for (const a of asks) {
  const s = (await c.execute({ sql: "SELECT start_day, prices FROM price_series WHERE game = ? AND card_id = ? AND variant = ? AND source = 'tcgplayer' AND currency = 'USD'", args: [a.game, a.card_id, a.variant] })).rows[0];
  let last = null, lastIdx = -1;
  if (s) { const p = JSON.parse(String(s.prices)); for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) { last = p[i]; lastIdx = i; break; } }
  const mp = a.manual_price == null ? null : Number(a.manual_price);
  const off = last != null && mp != null && mp > 0 ? Math.abs(last - mp) / mp : null;
  if (off == null || off > 0.1) {
    unbound++;
    console.log(`${a.manual}\t${a.game}\t${a.card_id}\t${a.variant}\tmanual ${mp} (${a.manual_day})\tread ${a.price_usd} (${a.day})\tstored ${last}${s ? ` @${s.start_day}+${lastIdx}` : " (no series)"}\toff ${off == null ? "?" : (off * 100).toFixed(0) + "%"}\t${a.label}`);
  }
}
console.log(`${asks.length} calls, ${unbound} not binding today`);
