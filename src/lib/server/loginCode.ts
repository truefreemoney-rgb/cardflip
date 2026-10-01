import "server-only";
import { createHash, randomInt } from "node:crypto";
import { db } from "@/lib/db";
import type { User } from "@/lib/server/users";
import { emailConfirmDevEcho, sendLoginCodeEmail } from "@/lib/server/mail";
import { cleanCode, sendBounded } from "@/lib/server/emailVerify";
import { reportServerError } from "@/lib/server/errorLog";

/**
 * Sign-in codes by email for admin accounts (Chris, 09-30: "just make it email
 * me a code"). The 10-01 sweep found the admin role skipped two-step at login
 * although it is the strongest account on the site. On the live site an admin's
 * password now only gets a 6-digit code mailed to the account's address; the
 * login is re-submitted with it, the same way the authenticator flow works.
 *
 * One live code per user (a resend replaces it), sha256 only, 10 minutes,
 * 5 tries, used once. Local and CI logins stay code-free (dev-test accounts).
 */

export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
/** A code mailed less than this long ago is not mailed again. */
export const LOGIN_CODE_RESEND_MS = 60 * 1000;
export const LOGIN_CODE_SOURCE = "login-code";

const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

/** Does this account's password alone stop short of a session? Live site, admin role. */
export function loginCodeRequired(user: Pick<User, "role">): boolean {
  return user.role === "admin" && process.env.VERCEL_ENV === "production";
}

/** Local and CI only (EMAIL_CONFIRM_DEV_ECHO=1): the last sign-in code logged for an address. */
const devCodes = new Map<string, string>();
export function devLastLoginCode(email: string): string | undefined {
  return emailConfirmDevEcho() ? devCodes.get(email.trim().toLowerCase()) : undefined;
}

/**
 * Mail a fresh code. "waiting" = one went out under a minute ago and still
 * works, so nothing new is sent; "failed" = it could not be delivered (the row
 * is dropped, so the next try sends again) and the Errors page hears about it.
 */
export async function sendLoginCode(
  user: Pick<User, "id" | "email">,
  now = Date.now(),
  mail: (to: string, code: string) => Promise<void> = sendLoginCodeEmail,
): Promise<"sent" | "waiting" | "failed"> {
  const live = await db
    .prepare("SELECT created_at FROM login_codes WHERE user_id = ? AND expires_at > ?")
    .get<{ created_at: number }>(user.id, now);
  if (live && now - Number(live.created_at) < LOGIN_CODE_RESEND_MS) return "waiting";

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db
    .prepare(
      `INSERT INTO login_codes (user_id, code_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at,
         expires_at = excluded.expires_at, attempts = 0`,
    )
    .run(user.id, hashCode(user.id, code), now, now + LOGIN_CODE_TTL_MS);

  if (emailConfirmDevEcho()) {
    devCodes.set(user.email.trim().toLowerCase(), code);
    console.log(`[login-code] ${user.email}: ${code}`);
    return "sent";
  }
  const send = await sendBounded(() => mail(user.email, code));
  if (send.ok) return "sent";
  await db.prepare("DELETE FROM login_codes WHERE user_id = ?").run(user.id);
  const detail = send.err instanceof Error ? send.err.message : String(send.err);
  await reportServerError(LOGIN_CODE_SOURCE, new Error(`${send.kind}: ${detail} (admin sign-in code not sent)`));
  return "failed";
}

/** Spend one try on the live code; true once, for the right code, inside its 10 minutes. */
export async function spendLoginCode(userId: string, raw: unknown, now = Date.now()): Promise<boolean> {
  const code = cleanCode(raw);
  if (!code) return false;
  const tried = await db
    .prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE user_id = ? AND expires_at > ? AND attempts < ?")
    .run(userId, now, LOGIN_CODE_MAX_ATTEMPTS);
  if (tried.changes < 1) return false;
  const used = await db.prepare("DELETE FROM login_codes WHERE user_id = ? AND code_hash = ?").run(userId, hashCode(userId, code));
  return used.changes === 1;
}
