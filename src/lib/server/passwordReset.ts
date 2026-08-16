import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/server/password";
import { findUserById, isDemoUser, type User } from "@/lib/server/users";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Password resets, as one-time links.
 *
 * A reset link is a random token; only its SHA-256 lands in the database, so
 * a leaked DB can't be turned into working links. Links live an hour, work
 * once, and consuming one also ends every existing session for that user —
 * if the reset was prompted by a stolen password, the thief is logged out.
 *
 * Who issues them: the seller themselves via "Forgot password?" (emailed —
 * needs SMTP, see mail.ts), an admin from /admin (link shown once, to hand
 * to the user), or the operator via scripts/issue-reset-link.mjs when
 * they're the one locked out. All three go through issueResetToken.
 */

const RESET_TTL_MS = 60 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
`);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function resetUrl(token: string): string {
  return `${SITE_URL}/reset-password?token=${encodeURIComponent(token)}`;
}

export interface IssuedReset {
  token: string;
  url: string;
  expiresAt: number;
}

/**
 * Mint a fresh link for this user. Earlier unused links are revoked — one
 * live link per user keeps "I clicked the old email" failures explainable.
 * The demo account is never resettable: it's shared and wiped on entry.
 */
export function issueResetToken(user: Pick<User, "id" | "email">): IssuedReset {
  if (isDemoUser(user)) throw new Error("The demo account has no password to reset");
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + RESET_TTL_MS;
  db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").run(user.id);
  db.prepare(
    "INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(hashToken(token), user.id, now, expiresAt);
  return { token, url: resetUrl(token), expiresAt };
}

/** Which user a link belongs to, if it's still good. Doesn't consume it. */
export function peekResetToken(token: string): User | null {
  const row = db
    .prepare(
      "SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?",
    )
    .get(hashToken(token)) as
    | { user_id: string; expires_at: number; used_at: number | null }
    | undefined;
  if (!row || row.used_at != null || row.expires_at < Date.now()) return null;
  return findUserById(row.user_id);
}

/**
 * Set the new password and burn the link. Returns the user (so the caller can
 * log them straight in) or null when the link is unknown, used, or expired.
 */
export function consumeResetToken(token: string, newPassword: string): User | null {
  const user = peekResetToken(token);
  if (!user) return null;
  const now = Date.now();
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    user.id,
  );
  db.prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ?").run(
    now,
    hashToken(token),
  );
  // Every other device is signed out; the caller issues a fresh session.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  return findUserById(user.id);
}

/** Same floor as signup (api/auth/signup), so a reset can't set a password signup would reject. */
export function passwordProblem(password: string): string | null {
  if (password.length < 6) return "Password must be at least 6 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}
