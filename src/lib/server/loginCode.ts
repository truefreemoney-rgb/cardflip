import "server-only";
import { createHash, randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { OWNER_EMAIL, type User } from "@/lib/server/users";
import type { AdminRole } from "@/lib/adminAuth";
import { emailConfirmDevEcho, sendLoginCodeEmail } from "@/lib/server/mail";
import { cleanCode, sendBounded } from "@/lib/server/emailVerify";
import { reportServerError } from "@/lib/server/errorLog";

/**
 * Sign-in codes by email for admins only (Chris, 09-30: "just make it email
 * me a code"; "it should only be for admin, not normal users"). The 10-01
 * sweep found the strongest logins on the site had no second step. On the
 * live site two logins now stop at the password and mail a 6-digit code:
 *
 *  - an admin-role seller account at /login (code goes to the account's address);
 *  - the owner's /admin console login (code goes to OWNER_EMAIL).
 *
 * The login is re-submitted with the code, the same way the authenticator flow
 * works. One live code per login (a resend replaces it), sha256 only, 10
 * minutes, 5 tries, used once. Local and CI logins stay code-free (dev-test
 * accounts), and so does the helper's console login (Tasks page only).
 */

export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
/** A code mailed less than this long ago is not mailed again. */
export const LOGIN_CODE_RESEND_MS = 60 * 1000;
export const LOGIN_CODE_SOURCE = "login-code";

/** Where a login's one live code is kept: seller accounts by user id, the console by role. */
interface CodeStore {
  table: "login_codes" | "admin_login_codes";
  col: "user_id" | "who";
}
const ACCOUNT: CodeStore = { table: "login_codes", col: "user_id" };
const CONSOLE: CodeStore = { table: "admin_login_codes", col: "who" };
const CONSOLE_OWNER = "owner";

const hashCode = (key: string, code: string) => createHash("sha256").update(`${key}:${code}`).digest("hex");
const onLiveSite = () => process.env.VERCEL_ENV === "production";

/** Does this account's password alone stop short of a session? Live site, admin role. */
export function loginCodeRequired(user: Pick<User, "role">): boolean {
  return user.role === "admin" && onLiveSite();
}

/** Does this console login stop at the password? Live site, the owner (the helper sees Tasks only). */
export function consoleCodeRequired(role: AdminRole): boolean {
  return role === "owner" && onLiveSite();
}

/** Local and CI only (EMAIL_CONFIRM_DEV_ECHO=1): the last sign-in code logged for an address. */
const devCodes = new Map<string, string>();
export function devLastLoginCode(email: string): string | undefined {
  return emailConfirmDevEcho() ? devCodes.get(email.trim().toLowerCase()) : undefined;
}

type Mailer = (to: string, code: string) => Promise<void>;
export type CodeSend = "sent" | "waiting" | "failed";

/**
 * Mail a fresh code. "waiting" = one went out under a minute ago and still
 * works, so nothing new is sent; "failed" = it could not be delivered (the row
 * is dropped, so the next try sends again) and the Errors page hears about it.
 */
async function sendCode(store: CodeStore, key: string, email: string, now: number, mail: Mailer): Promise<CodeSend> {
  const live = await db
    .prepare(`SELECT created_at FROM ${store.table} WHERE ${store.col} = ? AND expires_at > ?`)
    .get<{ created_at: number }>(key, now);
  if (live && now - Number(live.created_at) < LOGIN_CODE_RESEND_MS) return "waiting";

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db
    .prepare(
      `INSERT INTO ${store.table} (${store.col}, code_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(${store.col}) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at,
         expires_at = excluded.expires_at, attempts = 0`,
    )
    .run(key, hashCode(key, code), now, now + LOGIN_CODE_TTL_MS);

  if (emailConfirmDevEcho()) {
    devCodes.set(email.trim().toLowerCase(), code);
    console.log(`[login-code] ${email}: ${code}`);
    return "sent";
  }
  const send = await sendBounded(() => mail(email, code));
  if (send.ok) return "sent";
  await db.prepare(`DELETE FROM ${store.table} WHERE ${store.col} = ?`).run(key);
  const detail = send.err instanceof Error ? send.err.message : String(send.err);
  await reportServerError(LOGIN_CODE_SOURCE, new Error(`${send.kind}: ${detail} (admin sign-in code not sent)`));
  return "failed";
}

/** Spend one try on the live code; true once, for the right code, inside its 10 minutes. */
async function spendCode(store: CodeStore, key: string, raw: unknown, now: number): Promise<boolean> {
  const code = cleanCode(raw);
  if (!code) return false;
  const tried = await db
    .prepare(`UPDATE ${store.table} SET attempts = attempts + 1 WHERE ${store.col} = ? AND expires_at > ? AND attempts < ?`)
    .run(key, now, LOGIN_CODE_MAX_ATTEMPTS);
  if (tried.changes < 1) return false;
  const used = await db.prepare(`DELETE FROM ${store.table} WHERE ${store.col} = ? AND code_hash = ?`).run(key, hashCode(key, code));
  return used.changes === 1;
}

/** An admin seller account: the code goes to the account's own address. */
export function sendLoginCode(user: Pick<User, "id" | "email">, now = Date.now(), mail: Mailer = sendLoginCodeEmail): Promise<CodeSend> {
  return sendCode(ACCOUNT, user.id, user.email, now, mail);
}
export function spendLoginCode(userId: string, raw: unknown, now = Date.now()): Promise<boolean> {
  return spendCode(ACCOUNT, userId, raw, now);
}

/** The owner's /admin console login: the code goes to OWNER_EMAIL. */
export function sendConsoleCode(now = Date.now(), mail: Mailer = sendLoginCodeEmail): Promise<CodeSend> {
  return sendCode(CONSOLE, CONSOLE_OWNER, OWNER_EMAIL, now, mail);
}
export function spendConsoleCode(raw: unknown, now = Date.now()): Promise<boolean> {
  return spendCode(CONSOLE, CONSOLE_OWNER, raw, now);
}
