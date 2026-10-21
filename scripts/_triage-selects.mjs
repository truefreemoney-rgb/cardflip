// READ ONLY (prod): the SELECT checks from the 10-21 TO-TEST triage (docs/TO-TEST-TRIAGE-2026-10-21.md). One query each.
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const Q = [
  ["230 copy rows since 10-18 23:20 UTC", "SELECT COUNT(*) n FROM email_sends WHERE status = 'copy' AND sent_at > strftime('%s','2026-10-18 23:20:00')*1000"],
  ["230 10-20 sends by status", "SELECT campaign, status, COUNT(*) n FROM email_sends WHERE sent_at BETWEEN strftime('%s','2026-10-20 13:00:00')*1000 AND strftime('%s','2026-10-20 16:00:00')*1000 GROUP BY 1,2"],
  ["232 log_cleanup_last", "SELECT key, substr(value,1,120) v FROM settings WHERE key LIKE '%cleanup%'"],
  ["300 10-18 posts with Rare Candy / Vivid Voltage", "SELECT SUM(text LIKE '%Rare Candy%') rare_candy, SUM(text LIKE '%Vivid Voltage%') vivid FROM social_posts WHERE at LIKE '2026-10-18%'"],
  ["304 10-18 posts with Ninetales", "SELECT COUNT(*) n FROM social_posts WHERE at LIKE '2026-10-18%' AND text LIKE '%Ninetales%'"],
  ["317 visit: rows vs a day of page views", "SELECT (SELECT COUNT(*) FROM rate_limits WHERE key LIKE 'visit:%') visit_rows, (SELECT COUNT(*) FROM page_views WHERE at > (strftime('%s','now','-1 day')*1000)) views_day"],
  ["343 Art Series unpriced", "SELECT COUNT(*) n FROM mtg_cards WHERE set_name LIKE '%Art Series' AND price_usd IS NULL AND price_usd_foil IS NULL"],
  ["354 price_reports", "SELECT COUNT(*) n, MAX(created_at) last FROM price_reports"],
  ["440 FLIPBACK redemptions", "SELECT COUNT(*) n FROM promo_redemptions WHERE code = 'FLIPBACK'"],
  ["450 10-16 Magic 'this week' posts", "SELECT site, substr(text,1,90) t FROM social_posts WHERE at LIKE '2026-10-16%' AND text LIKE '%this week%' LIMIT 6"],
  ["464 email_claims rows", "SELECT COUNT(*) n FROM email_claims"],
  ["464 duplicate sends 10-18..19", "SELECT campaign, email, COUNT(*) n FROM email_sends WHERE status = 'sent' AND sent_at BETWEEN strftime('%s','2026-10-18 12:00:00')*1000 AND strftime('%s','2026-10-19 12:00:00')*1000 GROUP BY 1,2 HAVING COUNT(*) > 1 LIMIT 5"],
  ["474 refunded scans since 10-17", "SELECT COUNT(*) n FROM scan_usage WHERE refunded_at IS NOT NULL AND at > strftime('%s','2026-10-17')*1000"],
  ["601 hydration errors since 10-17", "SELECT COUNT(*) n FROM error_events WHERE message LIKE '%ydration%' AND at > strftime('%s','2026-10-17')*1000"],
  ["736 pack purchases by googleads signups", "SELECT COUNT(*) n FROM scan_pack_purchases p JOIN signup_log s ON s.user_id = p.user_id WHERE s.src LIKE '%googleads%'"],
  ["880 /scan landings since 10-06", "SELECT landing, COUNT(*) n FROM signup_log WHERE at > strftime('%s','2026-10-06')*1000 GROUP BY landing ORDER BY n DESC LIMIT 6"],
  ["932 cards with scan_market", "SELECT COUNT(*) n FROM cards WHERE scan_market IS NOT NULL"],
];
for (const [label, sql] of Q) {
  try { const rows = (await c.execute(sql)).rows; console.log(`${label}: ${JSON.stringify(rows)}`); }
  catch (e) { console.log(`${label}: ERR ${e.message.slice(0, 120)}`); }
}
