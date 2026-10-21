// Delete junk accounts a probing bot made (exact addresses only, each one on Chris's yes). Same statements as
// users.deleteUser; only unconfirmed (email_pending), no cards, no Stripe customer, made after the given time.
// First used 10-21 ~1:50am ET (Chris: "yes plus there are others now": Read Probe A/C, Alice Kim, timestamped Gmail).
//   node scripts/_delete-probes.mjs <after ISO> <email> [email...]          (dry run: lists what would go)
//   node scripts/_delete-probes.mjs <after ISO> <email> [email...] --go
import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const args = process.argv.slice(2).filter((a) => a !== "--go");
const AFTER = Date.parse(args[0] ?? "");
const EMAILS = args.slice(1);
if (!Number.isFinite(AFTER) || !EMAILS.length) throw new Error("usage: node scripts/_delete-probes.mjs <after ISO> <email> [email...] [--go]");const STATEMENTS = [
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
  sql: `SELECT u.id, u.email, u.email_pending, u.created_at, u.stripe_customer_id, (SELECT COUNT(*) FROM cards WHERE user_id = u.id) AS cards
        FROM users u WHERE u.email IN (${EMAILS.map(() => "?").join(",")})`,
  args: EMAILS,
})).rows;
const ok = rows.filter((r) => Number(r.email_pending) === 1 && Number(r.cards) === 0 && !r.stripe_customer_id && Number(r.created_at) > AFTER);
console.log(`found ${rows.length} of ${EMAILS.length}; deletable ${ok.length}`);
for (const r of rows) console.log(ok.includes(r) ? "  delete" : "  KEEP  ", JSON.stringify(r.email), "pending", r.email_pending, "cards", r.cards);
if (!go) { console.log("dry run; --go to delete"); process.exit(0); }
for (const r of ok) {
  await c.batch(STATEMENTS.map((sql) => ({ sql, args: [r.id] })), "write");
  console.log("  deleted", JSON.stringify(r.email));
}
const left = (await c.execute({ sql: `SELECT COUNT(*) AS n FROM users WHERE email IN (${EMAILS.map(() => "?").join(",")})`, args: EMAILS })).rows[0].n;
console.log("left in users:", left);
