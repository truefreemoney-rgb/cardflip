import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/server/password";
import { markEmailConfirmed } from "@/lib/server/emailVerify";
import { findUserById, type User } from "@/lib/server/users";
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

// Schema (password_resets) lives in lib/db.ts behind the adapter's schema gate.

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
 */
export async function issueResetToken(user: Pick<User, "id" | "email">): Promise<IssuedReset> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + RESET_TTL_MS;
  await db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").run(user.id);
  // The address is recorded with the link: what the link proves at consume
  // time is that inbox, not whatever the account's address has become.
  await db.prepare(
    "INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, email) VALUES (?, ?, ?, ?, ?)",
  ).run(hashToken(token), user.id, now, expiresAt, user.email.trim().toLowerCase());
  return { token, url: resetUrl(token), expiresAt };
}

/** A link that is still good: its user and the address it was mailed to (null on links from before that was recorded). */
async function liveResetLink(token: string): Promise<{ user: User; email: string | null } | null> {
  const row = (await db
    .prepare(
      "SELECT user_id, expires_at, used_at, email FROM password_resets WHERE token_hash = ?",
    )
    .get(hashToken(token))) as
    | { user_id: string; expires_at: number; used_at: number | null; email: string | null }
    | undefined;
  if (!row || row.used_at != null || row.expires_at < Date.now()) return null;
  const user = await findUserById(row.user_id);
  return user ? { user, email: row.email ?? null } : null;
}

/** Which user a link belongs to, if it's still good. Doesn't consume it. */
export async function peekResetToken(token: string): Promise<User | null> {
  return (await liveResetLink(token))?.user ?? null;
}

/**
 * Set the new password and burn the link. Returns the user (so the caller can
 * log them straight in) or null when the link is unknown, used, or expired.
 */
export async function consumeResetToken(token: string, newPassword: string): Promise<User | null> {
  const link = await liveResetLink(token);
  if (!link) return null;
  const { user } = link;
  const now = Date.now();
  // Burn the link first, in one statement: of two requests racing on the same
  // link only one gets to set a password.
  const burned = await db
    .prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?")
    .run(now, hashToken(token), now);
  if (Number(burned.changes) !== 1) return null;
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    user.id,
  );
  // Every other device is signed out; the caller issues a fresh session.
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  // A reset link reached the inbox it was mailed to (or an admin vouched for
  // it), so a signup still waiting on its email code is confirmed by it, but
  // only while that is still the address on the account: the link is bound
  // to the address recorded when it was made. This is also the way out for an
  // address squatted by a stranger's pending signup: the real owner resets,
  // and the squatter's sessions are gone. A link from before the address was
  // recorded proves no inbox.
  if (link.email) await markEmailConfirmed(user.id, { verified: true, email: link.email });
  return findUserById(user.id);
}

/** Same rules as signup (lib/passwordRules.ts), so a reset can't set a password signup would reject. */
export { passwordProblem } from "@/lib/passwordRules";
