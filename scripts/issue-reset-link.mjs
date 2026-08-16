/**
 * Operator escape hatch: mint a one-time password-reset link for any account,
 * straight against the database. For when the operator is the one locked out
 * (no admin session to use /admin, no SMTP yet for "Forgot password?").
 *
 *   Locally:  node scripts/issue-reset-link.mjs you@example.com
 *   On Fly:   flyctl ssh console --app cardflip-superior -C "node scripts/issue-reset-link.mjs you@example.com"
 *
 * Prints the URL; open it, set a new password, you're logged in. Same table
 * and rules as src/lib/server/passwordReset.ts (SHA-256 of the token stored,
 * 1 hour, single use, earlier unused links for that user revoked) — keep the
 * two in step if either changes.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/issue-reset-link.mjs <email>");
  process.exit(2);
}

const dbPath = process.env.CARDFLIP_DB_PATH ?? path.join(process.cwd(), "data", "cardflip.db");
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip-superior.fly.dev";
const db = new DatabaseSync(dbPath);

const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
if (!user) {
  console.error(`No account with email ${email} in ${dbPath}`);
  process.exit(1);
}
if (user.email === "demo@cardflip.dev") {
  console.error("The demo account has no password to reset.");
  process.exit(1);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
`);

const token = randomBytes(32).toString("base64url");
const now = Date.now();
db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").run(user.id);
db.prepare(
  "INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
).run(createHash("sha256").update(token).digest("hex"), user.id, now, now + 60 * 60 * 1000);

console.log(`\nReset link for ${user.email} (one use, 1 hour):\n`);
console.log(`${siteUrl}/reset-password?token=${encodeURIComponent(token)}\n`);
