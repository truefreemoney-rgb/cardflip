// Delete the 16 junk accounts of the 10-21 Tor probe wave (Chris 10-21 ~1:10am ET: "1 and 2 yes").
// Same statements as users.deleteUser; only exact addresses below, only unconfirmed, no cards, made 10-21 after 12:10am ET.
//   node scripts/_delete-probes-1021.mjs          (dry run: lists what would go)
//   node scripts/_delete-probes-1021.mjs --go
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const EMAILS = [
  "probe50406a@example.org", "zz-nobody-50404@example.com", "admin@cardflip.io..", "probe50406dot@example.org.",
  "probe50406sig@example.org", "probe.1792557316@example.org", "probe.1792557350@example.org", "probe.1792557382@example.org",
  "probe.1792557417@example.org", "probe.1792557492@example.org", "probe.1792557511@example.org", "probe.1792557533@example.org",
  "zzq-taildot-ret-5521@example.com", "rnd1792558105201692@example.com", "admin@cardflip.io.", "rnd21792558505@example.com",
];
const AFTER = Date.parse("2026-10-21T04:10:00Z");
const STATEMENTS = [
  "DELETE FROM card_photos WHERE card_id IN (SELECT id FROM cards WHERE user_id = ?1)",
  "DELETE FROM cards WHERE user_id = ?1",
  "DELETE FROM sessions WHERE user_id = ?1",
  "DELETE FROM ebay_tokens WHERE user_id = ?1",
  "DELETE FROM push_subscriptions WHERE user_id = ?1",
  "DELETE FROM wishlist_items WHERE user_id = ?1",
  "DELETE FROM price_checks WHERE user_id = ?1",
  "DELETE FROM help_messages WHERE user_id = ?1",
  "DELETE FROM support_ticket_notes WHERE user_id = ?1",
  "DELETE FROM support_tickets WHERE user_id = ?1",
  "DELETE FROM password_resets WHERE user_id = ?1",
  "DELETE FROM email_verifications WHERE user_id = ?1",
  "DELETE FROM login_codes WHERE user_id = ?1",
  "DELETE FROM pending_scans WHERE user_id = ?1",
  "DELETE FROM pending_watches WHERE user_id = ?1",
  "DELETE FROM categories WHERE user_id = ?1",
  "DELETE FROM packs WHERE user_id = ?1",
  "DELETE FROM email_sends WHERE user_id = ?1 OR lower(email) = (SELECT lower(email) FROM users WHERE id = ?1)",
  "DELETE FROM card_removals WHERE user_id = ?1",
  "DELETE FROM signup_log WHERE user_id IN (SELECT id FROM users WHERE id = ?1 AND email_pending = 1)",
  "UPDATE users SET referred_by = NULL WHERE referred_by = ?1",
  "DELETE FROM users WHERE id = ?1",
];
const go = process.argv.includes("--go");
const rows = (await c.execute({
  sql: `SELECT u.id, u.email, u.email_pending, u.created_at, (SELECT COUNT(*) FROM cards WHERE user_id = u.id) AS cards
        FROM users u WHERE u.email IN (${EMAILS.map(() => "?").join(",")})`,
  args: EMAILS,
})).rows;
const ok = rows.filter((r) => Number(r.email_pending) === 1 && Number(r.cards) === 0 && Number(r.created_at) > AFTER);
console.log(`found ${rows.length} of ${EMAILS.length}; deletable ${ok.length}`);
for (const r of rows) console.log(ok.includes(r) ? "  delete" : "  KEEP  ", JSON.stringify(r.email), "pending", r.email_pending, "cards", r.cards);
if (!go) { console.log("dry run; --go to delete"); process.exit(0); }
for (const r of ok) {
  await c.batch(STATEMENTS.map((sql) => ({ sql, args: [r.id] })), "write");
  console.log("  deleted", JSON.stringify(r.email));
}
const left = (await c.execute({ sql: `SELECT COUNT(*) AS n FROM users WHERE email IN (${EMAILS.map(() => "?").join(",")})`, args: EMAILS })).rows[0].n;
console.log("left in users:", left);
