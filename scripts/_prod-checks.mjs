// Read-only prod checks for the 10-18 task sweep (SELECTs only).
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const q = async (label, sql, args = []) => {
  try {
    const r = await c.execute({ sql, args });
    console.log(`\n## ${label}`);
    for (const row of r.rows) console.log(JSON.stringify(row).slice(0, 600));
  } catch (e) {
    console.log(`\n## ${label}: ERROR ${e.message}`);
  }
};
const tail = (col) => `substr(${col}, -70)`;
await q("price_checked", "SELECT game, card_id, variant, usd, day, tcg_usd, tcg_day, off_day FROM price_checked");
await q(
  "art versions + 1st ed series tails",
  `SELECT card_id, variant, updated_day, ${tail("prices")} p FROM price_series WHERE source='tcgplayer' AND card_id IN ('xy1-17','xy1-17-highplains','base1-58-1st','base1-58-redcheeks-1st','swsh10.5-006-peelable','swsh10.5-013-peelable','swsh10.5-059-peelable')`,
);
await q("Ascended Heroes pattern variants", "SELECT variant, COUNT(*) n, MAX(updated_day) d FROM price_series WHERE card_id LIKE 'me02.5-%' AND source='tcgplayer' GROUP BY variant");
await q("Cresselia / Victini", `SELECT card_id, variant, updated_day, ${tail("prices")} p FROM price_series WHERE source='tcgplayer' AND card_id IN ('bw7-143','bw9-131')`);
await q("daily_last_result", "SELECT value FROM settings WHERE key='daily_last_result'");
await q("fx", "SELECT * FROM settings WHERE key LIKE 'fx%' LIMIT 8");
await q("email_claims today", "SELECT COUNT(*) n FROM email_claims");
await q("FLIPBACK", "SELECT COUNT(*) n FROM promo_redemptions WHERE code='FLIPBACK'");
await q("price_reports", "SELECT * FROM price_reports ORDER BY rowid DESC LIMIT 5");
await q("visit rate rows", "SELECT COUNT(*) n FROM rate_limits WHERE key LIKE 'visit:%'");
await q("rate_limits total", "SELECT COUNT(*) n FROM rate_limits");
await q("scan_market column", "SELECT COUNT(*) n FROM pragma_table_info('cards') WHERE name='scan_market'");
await q("admin_logouts", "SELECT COUNT(*) n FROM admin_logouts");
await q("sessions > 365d", "SELECT COUNT(*) n FROM sessions WHERE created_at < (strftime('%s','now') - 365*86400) * 1000");
await q("idx_price_checks_user", "SELECT name FROM sqlite_master WHERE name='idx_price_checks_user'");
await q("heat now", "SELECT (SELECT COUNT(*) FROM heat_views) v, (SELECT COUNT(*) FROM heat_taps) t, (SELECT COUNT(*) FROM heat_views WHERE page LIKE '/admin%') admin");
await q("email_sends orphans", "SELECT COUNT(*) n FROM email_sends WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)");
await q("1st ed charizard", "SELECT id, name FROM en_cards WHERE id IN ('base1-4','base1-4-1st')");
await q("settings keys today", "SELECT key FROM settings WHERE key LIKE '%2026-10-18%' OR key LIKE 'ebay_referee%' OR key LIKE 'referee%' LIMIT 30");
