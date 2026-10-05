import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { isValidEmail } from "@/lib/emailAddress";
import { SITE_URL } from "@/lib/siteUrl";
import { dayBudgetSpent, dayBudgetUsed } from "@/lib/server/dayBudget";
import { reportServerError } from "@/lib/server/errorLog";
import {
  emailConfirmActive,
  emailConfirmDevEcho,
  isMailConfigured,
  sendConfirmEmail,
  sendSignupWelcomeEmail,
} from "@/lib/server/mail";
import { LIMITS, clientIp, type RateLimitRule } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { getSetting } from "@/lib/server/settings";
import { inboxKey, isDisposableEmail } from "@/lib/server/signupGuard";
import {
  TRIAL_SCANS,
  findUserByEmail,
  findUserById,
  needsEmailConfirm,
  toPublicUser,
  trialScansLeft,
  type PublicUser,
  type User,
} from "@/lib/server/users";

/**
 * Email confirmation (Chris, 09-30): a public signup proves its inbox with a
 * 6-digit code typed in the app, or the button in the same email.
 *
 * The switch. Confirmation is ON only while the settings row email_confirm is
 * exactly "1" (the /admin/switches row). No row, or any other value, is OFF:
 * shipping this code changes nothing for anyone until the owner flips it.
 *
 * Who can be walled. Only users.email_pending = 1 accounts, which only the
 * public signup route creates while the switch is on; users.needsEmailConfirm
 * then also requires the trial tier, so subscribers, Scan Pack holders,
 * legacy, comped, owner, admin and every account from before this shipped
 * can never be walled. Turning the switch off releases everyone waiting.
 *
 * Codes and links. Every send is one row in email_verifications: a random
 * 6-digit code (sha256 stored) and a random link token (sha256 stored), good
 * for an hour, the code for 5 wrong tries. A resend adds a row and keeps the
 * previous one alive, so the mail already in the inbox still works; a
 * different target address kills the older rows. A confirmed or replaced row
 * is kept, so an old link can say "already confirmed" instead of "expired".
 * The emailed link is GET peek, then POST confirm (mail scanners prefetch
 * GETs). Signup and wall mails carry the link only (10-05: ad visitors sign up
 * in TikTok's in-app browser, where the camera cannot run, so confirming has to
 * move them to a real browser): the POST that freshly lifts a wall also signs
 * that browser in (the route does it, from consumeLink's userId). A link that
 * was already used signs nobody in. Email-change mails keep the typed code.
 *
 * A proof is for one inbox. Every door that vouches for an address (code,
 * link, reset link) lifts the wall only while that is still the address on the
 * account (markEmailConfirmed's `email`), reset links are recorded with the
 * address they were mailed to and die when it changes, and a code mailed to a
 * typed address is limited per address, per account and per network per day.
 *
 * SMTP is never a dead end. Delivery is bounded (6 s), a broken mail server,
 * a refused sender, a rate limit or an over-budget day releases the account
 * instead of walling it (and reports to the Errors page as "email-confirm"),
 * and only the recipient's own permanent refusal keeps the wall, because that
 * one is the user's typo to fix (reported as "email-confirm-address").
 */

export const EMAIL_CONFIRM_KEY = "email_confirm";
/** Errors-page sources: our-side failures, and addresses the mail server refused. */
export const FAILED_SOURCE = "email-confirm";
export const REFUSED_SOURCE = "email-confirm-address";
export const CODE_TTL_MS = 60 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
/** The 30-second resend gap (LIMITS.emailCode), for the client's countdown. */
export const RESEND_COOLDOWN_SECONDS = 30;
/**
 * Confirmation mails per UTC day, signups and resends together. Past it,
 * signups skip the wall and report, so a script cannot burn the shared
 * mailbox's daily cap and wall everyone else. Fastmail's real limit is not
 * recorded anywhere in the repo: check it and adjust.
 */
export const CONFIRM_MAIL_DAY_BUDGET = 500;
export const CONFIRM_MAIL_BUDGET_NAME = "confirm_mail";
/** How long a request waits on SMTP before it moves on (the phone gives up at 15 s). */
export const SEND_TIMEOUT_MS = 6000;
/** Finished rows are pruned this long after they were made. */
const KEEP_ROWS_MS = 2 * 24 * 60 * 60 * 1000;

const normalize = (s: string) => s.trim().toLowerCase();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hashCode = (userId: string, code: string) => sha(`${userId}:${code}`);
const hashLink = (token: string) => sha(token);

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "s***@example.com": enough for the owner of the inbox to recognise it. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Digits only, exactly six, or null: "482 913" and "Code: 482913" both work. */
export function cleanCode(raw: unknown): string | null {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  return digits.length === 6 ? digits : null;
}

// --- the switch ---------------------------------------------------------------

/** Is the /admin/switches row on? Exactly "1"; a missing row is off. */
export async function emailConfirmSwitchOn(): Promise<boolean> {
  return (await getSetting(EMAIL_CONFIRM_KEY)) === "1";
}

/** Should a signup right now be walled behind a code? Switch on AND a way to deliver it. */
export async function emailConfirmEnabled(): Promise<boolean> {
  return emailConfirmActive() && (await emailConfirmSwitchOn());
}

// --- rows ---------------------------------------------------------------------

interface VRow {
  link_hash: string;
  user_id: string;
  email: string;
  code_hash: string;
  created_at: number;
  expires_at: number;
  attempts: number;
  confirmed_at: number | null;
  dead_at: number | null;
}

export interface IssuedVerification {
  code: string;
  token: string;
  url: string;
  expiresAt: number;
  /** The normalised address the code was made for. */
  email: string;
  /** The stored key of this row (sha256 of the link token). */
  linkHash: string;
}

export function confirmUrl(token: string): string {
  return `${SITE_URL}/confirm-email?t=${encodeURIComponent(token)}`;
}

/**
 * Make a fresh code and link for `to`. Rows for any other address are killed
 * (the owner of a typo must not be able to confirm the corrected account);
 * for the same address the newest earlier row stays alive next to the new one,
 * so tapping Send a New Code never kills the mail already on the phone.
 * Refuses anything that is not exactly one address: this is the one door
 * every confirmation mail goes through.
 */
export async function issueEmailVerification(
  user: Pick<User, "id">,
  to: string,
  now = Date.now(),
): Promise<IssuedVerification> {
  const email = normalize(to);
  if (!isValidEmail(email)) throw new Error("Not a single valid email address");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + CODE_TTL_MS;
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        "UPDATE email_verifications SET dead_at = ? WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL AND email <> ?",
      )
      .run(now, user.id, email);
    await tx
      .prepare(
        `UPDATE email_verifications SET dead_at = ?
          WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL
            AND link_hash NOT IN (
              SELECT link_hash FROM email_verifications
               WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL
               ORDER BY created_at DESC, rowid DESC LIMIT 1)`,
      )
      .run(now, user.id, user.id);
    await tx
      .prepare(
        `INSERT INTO email_verifications (link_hash, user_id, email, code_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(hashLink(token), user.id, email, hashCode(user.id, code), now, expiresAt);
    await tx.prepare("DELETE FROM email_verifications WHERE user_id = ? AND created_at < ?").run(user.id, now - KEEP_ROWS_MS);
  });
  return { code, token, url: confirmUrl(token), expiresAt, email, linkHash: hashLink(token) };
}

/** The newest code that can still be used, and where it went. */
export async function liveVerification(userId: string, now = Date.now()): Promise<{ email: string; expiresAt: number } | null> {
  const row = await db
    .prepare(
      `SELECT email, expires_at FROM email_verifications
        WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get<{ email: string; expires_at: number }>(userId, now);
  return row ? { email: row.email, expiresAt: Number(row.expires_at) } : null;
}

/** An email change waiting for its code: a live row for an address other than the account's own. */
export async function pendingEmailChange(user: Pick<User, "id" | "email">, now = Date.now()): Promise<{ email: string; expiresAt: number } | null> {
  const live = await liveVerification(user.id, now);
  return live && live.email !== user.email ? live : null;
}

/**
 * An email change that was asked for and never finished, even if its code has
 * run out since: an unused row for an address other than the account's own,
 * made within the retention window. pendingEmailChange only sees live codes,
 * so on its own a change that expired looks like "nothing pending", and a
 * stale screen would be told the change went through. Rows a failed send
 * killed (dead_at) are not attempts.
 */
export async function lastChangeAttempt(user: Pick<User, "id" | "email">, now = Date.now()): Promise<{ email: string; expiresAt: number } | null> {
  const row = await db
    .prepare(
      `SELECT email, expires_at FROM email_verifications
        WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL AND email <> ? AND created_at > ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get<{ email: string; expires_at: number }>(user.id, user.email, now - KEEP_ROWS_MS);
  return row ? { email: row.email, expiresAt: Number(row.expires_at) } : null;
}

/**
 * Is there truly nothing left to confirm for this account: not walled, no live
 * code, and no email change that lapsed? Only then may a verify or resend
 * answer "already confirmed"; a lapsed change must answer "expired", or the
 * account page would announce an email change that never happened.
 */
export async function nothingWaiting(user: User): Promise<boolean> {
  return !needsEmailConfirm(user) && !(await liveVerification(user.id)) && !(await lastChangeAttempt(user));
}

/** Kill every unused code and link for a user (a change that could not be mailed). */
export async function killVerifications(userId: string, now = Date.now()): Promise<void> {
  await db.prepare("UPDATE email_verifications SET dead_at = ? WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL").run(now, userId);
}

/** Kill one row (the code that could not be mailed), leaving any earlier mail that did arrive alone. */
async function killVerification(linkHash: string, now = Date.now()): Promise<void> {
  await db.prepare("UPDATE email_verifications SET dead_at = ? WHERE link_hash = ? AND confirmed_at IS NULL AND dead_at IS NULL").run(now, linkHash);
}

/**
 * The sign-in address moved, so a password-reset link mailed to the old one
 * must not keep working (or vouch for the new one). Unused links only.
 */
async function revokeResetLinks(userId: string): Promise<void> {
  await db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").run(userId);
}

// --- sending ------------------------------------------------------------------

export type SendResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * recipient = the address itself was refused (the user's typo to fix, so
       * the wall stays); transport = SMTP, timeout or misconfiguration;
       * budget = today's confirmation-mail cap is spent. Only recipient keeps
       * an account walled.
       */
      kind: "recipient" | "transport" | "budget";
      err: unknown;
    };

/**
 * Whose fault is a failed send? Only the recipient's own permanent refusal
 * (RCPT TO answered 5xx: no such user, bad domain) or an address nodemailer
 * cannot parse at all is the user's to fix. A refused sender (MAIL FROM), a
 * rate or quota answer (4xx anywhere), a login failure, a dropped connection
 * or a timeout is our side, and must never hold anyone behind the wall.
 */
export function classifySendError(err: unknown): "recipient" | "transport" {
  const e = err as { code?: unknown; command?: unknown; responseCode?: unknown } | null;
  const code = typeof e?.responseCode === "number" ? e.responseCode : 0;
  if (e?.command === "RCPT TO" && code >= 500 && code < 600) return "recipient";
  if (e?.code === "EENVELOPE" && !e.command) return "recipient";
  return "transport";
}

/** Run a send, but stop waiting for it after `ms`; the send itself carries on unobserved. */
export async function sendBounded(send: () => Promise<void>, ms = SEND_TIMEOUT_MS): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sending = send();
    sending.catch(() => {}); // a send that loses the race must not surface later as an unhandled rejection
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`mail send timed out after ${ms} ms`), { code: "ETIMEDOUT" })), ms);
    });
    await Promise.race([sending, timeout]);
    return { ok: true };
  } catch (err) {
    return { ok: false, kind: classifySendError(err), err };
  } finally {
    clearTimeout(timer);
  }
}

/** Local and CI only (EMAIL_CONFIRM_DEV_ECHO=1): the last code logged for an address. */
const devCodes = new Map<string, { code: string; url: string }>();
export function devLastCode(email: string): { code: string; url: string } | undefined {
  return emailConfirmDevEcho() ? devCodes.get(normalize(email)) : undefined;
}

/**
 * Run `work` once the response has gone out. On Vercel `after()` keeps the
 * function alive for it, so a slow mail server neither holds the phone on
 * "Confirming…" nor loses the mail when the function is frozen. Outside a
 * request (scripts, the test suite) there is no `after`, so it just starts.
 */
export async function afterResponse(work: () => Promise<void>): Promise<void> {
  const safe = async () => {
    try {
      await work();
    } catch (err) {
      console.error("email-confirm: deferred work failed:", err);
    }
  };
  try {
    const { after } = await import("next/server");
    after(safe);
  } catch {
    void safe();
  }
}

/** Mail (or, in dev echo, log) one code. Never throws; the result says what happened. */
export async function deliverConfirmCode(to: string, code: string, url: string, linkOnly = false): Promise<SendResult> {
  if (!isValidEmail(to)) return { ok: false, kind: "recipient", err: new Error("Not a single valid email address") };
  if (emailConfirmDevEcho()) {
    console.log(`[email-confirm] to=${to} code=${code} link=${url}`);
    devCodes.set(normalize(to), { code, url });
  }
  if (!isMailConfigured()) {
    return emailConfirmDevEcho() ? { ok: true } : { ok: false, kind: "transport", err: new Error("Mail isn't configured on this server") };
  }
  try {
    if (await dayBudgetSpent(CONFIRM_MAIL_BUDGET_NAME, CONFIRM_MAIL_DAY_BUDGET)) {
      return { ok: false, kind: "budget", err: new Error(`confirmation mail budget of ${CONFIRM_MAIL_DAY_BUDGET} a day is used up`) };
    }
  } catch {
    // The counter is a guard, not a gate: a broken counter never stops a code.
  }
  return sendBounded(() => sendConfirmEmail(to, code, url, linkOnly));
}

/** Issue a row and mail it. The row exists even when the mail fails, so a late arrival still works. */
export async function issueAndDeliver(
  user: Pick<User, "id">,
  to: string,
  opts: { linkOnly?: boolean } = {},
): Promise<{ issued: IssuedVerification; send: SendResult }> {
  const issued = await issueEmailVerification(user, to);
  return { issued, send: await deliverConfirmCode(issued.email, issued.code, issued.url, opts.linkOnly === true) };
}

/**
 * A recipient the mail server refused is the user's typo, not an outage, so it
 * gets its own Errors-page source: a handful a day is people, but a burst of
 * them is something else wearing a recipient's face (a quota answer on the
 * wrong command) and shows up in emailConfirmStats().refusedLast24h.
 */
async function noteRefused(detail: string): Promise<void> {
  await reportServerError(REFUSED_SOURCE, new Error(`recipient refused: ${detail}`));
}

/**
 * A code could not be delivered to a walled account. A refused recipient keeps
 * the wall (the user fixes the address); anything else is our failure, so the
 * account is released instead of stranded, and the Errors page hears about it.
 *
 * A refused address never received anything, so its row is killed when `issued`
 * says which one it was: left live, the wall would come back to "We sent a
 * code to ..." for a mail that cannot arrive, and would not send a new one.
 * (Only that row: mail already delivered to a good address stays valid.)
 */
export async function settleFailedSend(
  user: Pick<User, "id">,
  send: Extract<SendResult, { ok: false }>,
  issued?: Pick<IssuedVerification, "linkHash">,
): Promise<"kept" | "released"> {
  const detail = send.err instanceof Error ? send.err.message : String(send.err);
  if (send.kind === "recipient") {
    await noteRefused(detail);
    if (issued) await killVerification(issued.linkHash);
    return "kept";
  }
  await reportServerError(FAILED_SOURCE, new Error(`${send.kind}: ${detail} (account released without confirmation)`));
  await markEmailConfirmed(user.id, { verified: false });
  return "released";
}

// --- confirming ---------------------------------------------------------------

/**
 * The one door out of the wall: code, link, reset link, an admin's Mark
 * Confirmed and the switch going off all come through here. One statement
 * flips email_pending 1 to 0 (so only one caller ever "wins"), stamps
 * email_verified_at when an inbox was really proven, and settles the free
 * trial: when another confirmed or since-deleted signup already used this
 * device or IP, this account starts with the trial spent, exactly as a repeat
 * signup does today. Signups waiting on their own code never burn the slot,
 * so of several on one device the first to get in keeps the scans.
 * `changed` is false when the account was not pending.
 *
 * `email` binds the flip to the address the proof was for: a code, link or
 * reset that vouches for one inbox must not lift the wall on an account that
 * has since moved to another (Change Email lands between a proof and its
 * use). Every door that proves an inbox passes it; a release does not claim
 * any inbox, and the admin's Mark Confirmed is the owner's own call.
 */
export async function markEmailConfirmed(
  userId: string,
  opts: { verified?: boolean; now?: number; email?: string } = {},
): Promise<{ changed: boolean }> {
  const verified = opts.verified !== false;
  const now = opts.now ?? Date.now();
  const bound = typeof opts.email === "string";
  const res = await db
    .prepare(
      `UPDATE users SET
         email_pending = 0,
         email_verified_at = CASE WHEN ? = 1 THEN COALESCE(email_verified_at, ?) ELSE email_verified_at END,
         trial_scans_used = CASE WHEN
             EXISTS (SELECT 1 FROM signup_log me
                       JOIN signup_log o ON o.device_id = me.device_id AND o.user_id <> me.user_id
                       LEFT JOIN users ou ON ou.id = o.user_id
                      WHERE me.user_id = users.id AND (ou.id IS NULL OR ou.email_pending = 0))
          OR EXISTS (SELECT 1 FROM signup_log me
                       JOIN signup_log o ON o.ip_hash = me.ip_hash AND o.user_id <> me.user_id
                       LEFT JOIN users ou ON ou.id = o.user_id
                      WHERE me.user_id = users.id AND me.ip_hash IS NOT NULL AND (ou.id IS NULL OR ou.email_pending = 0))
          OR EXISTS (SELECT 1 FROM signup_log me
                       JOIN signup_log o ON o.inbox_key = me.inbox_key AND o.user_id <> me.user_id
                       LEFT JOIN users ou ON ou.id = o.user_id
                      WHERE me.user_id = users.id AND me.inbox_key IS NOT NULL AND (ou.id IS NULL OR ou.email_pending = 0))
           THEN MAX(trial_scans_used, ?) ELSE trial_scans_used END
       WHERE id = ? AND email_pending = 1${bound ? " AND email = ?" : ""}`,
    )
    .run(verified ? 1 : 0, now, TRIAL_SCANS, userId, ...(bound ? [normalize(opts.email!)] : []));
  if (res.changes < 1) return { changed: false };
  // Mail already in inboxes: the account is in either way, so a button tapped
  // late says "already confirmed" (the app agrees), never "expired" with a
  // Send a New Code button that does not exist once someone is through.
  await db.prepare("UPDATE email_verifications SET confirmed_at = ? WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL").run(now, userId);
  return { changed: true };
}

/** The switch went off: let everyone waiting straight in, oldest first (so the trial rule still holds). */
export async function releaseAllPending(): Promise<number> {
  const rows = await db.prepare("SELECT id FROM users WHERE email_pending = 1 ORDER BY created_at ASC").all<{ id: string }>();
  let released = 0;
  for (const r of rows) if ((await markEmailConfirmed(r.id, { verified: false })).changed) released++;
  return released;
}

/**
 * The welcome mail, once, when an account comes out of the wall on a proven
 * inbox. Sent after the response (afterResponse): the phone is not held on
 * "Confirming…" for a mail send, and Vercel keeps the function alive for it.
 */
function sendWelcomeAfterConfirm(userId: string): Promise<void> {
  if (!isMailConfigured()) return Promise.resolve();
  return afterResponse(async () => {
    const u = await findUserById(userId);
    if (!u) return;
    try {
      await sendSignupWelcomeEmail(u.email, u.name.split(" ")[0], trialScansLeft(u));
    } catch (err) {
      console.error(`email-confirm: welcome email to ${u.email} failed:`, err);
    }
  });
}

const isUniqueViolation = (err: unknown) => /UNIQUE|constraint/i.test(err instanceof Error ? err.message : String(err));

export type ApplyOutcome =
  | { status: "confirmed"; user: User; wasPending: boolean }
  | { status: "taken" }
  | { status: "stale" };

/**
 * A used row takes effect. The account's own address: lift the wall (and send
 * the welcome, only if this call was the one that lifted it). A different
 * address on an established account: it becomes the sign-in email, stamped
 * proven; no wall, no trial settling, no welcome. The address is normalised
 * again here, so a mixed-case row can never lock anyone out of login.
 *
 * The wall only lifts for the address the row was made for: if the account
 * moved to another between the read and the flip (a Change Email racing the
 * code), nothing is confirmed and the used row is retired as replaced.
 */
async function applyRow(userId: string, row: VRow): Promise<ApplyOutcome> {
  const user = await findUserById(userId);
  if (!user) return { status: "stale" };
  const target = normalize(row.email);
  // A used row that confirmed nothing is retired as replaced, not left "confirmed".
  const retire = async (): Promise<ApplyOutcome> => {
    await db.prepare("UPDATE email_verifications SET confirmed_at = NULL, dead_at = ? WHERE link_hash = ?").run(Date.now(), row.link_hash);
    return { status: "stale" };
  };
  if (target === user.email) {
    let wasPending = false;
    if (user.emailPending) {
      wasPending = (await markEmailConfirmed(userId, { email: target })).changed;
      if (wasPending) {
        await sendWelcomeAfterConfirm(userId);
      } else if ((await findUserById(userId))?.emailPending) {
        return retire();
      }
    }
    return { status: "confirmed", user: (await findUserById(userId)) ?? user, wasPending };
  }
  // A walled account's rows for any other address died when it changed address.
  if (needsEmailConfirm(user)) return retire();
  const other = await findUserByEmail(target);
  if (other && other.id !== userId) return { status: "taken" };
  try {
    await db.prepare("UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?").run(target, Date.now(), userId);
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "taken" };
    throw err;
  }
  await revokeResetLinks(userId);
  // Every mail sent for this address is spent with it (a resend left a sibling
  // live), so a stale screen typing the other code hears "already confirmed".
  await db
    .prepare("UPDATE email_verifications SET confirmed_at = ? WHERE user_id = ? AND email = ? AND confirmed_at IS NULL AND dead_at IS NULL")
    .run(Date.now(), userId, target);
  if (user.emailPending) await markEmailConfirmed(userId, { email: target });
  return { status: "confirmed", user: (await findUserById(userId)) ?? user, wasPending: false };
}

export type CodeResult =
  | { state: "confirmed"; user: User; wasPending: boolean }
  | { state: "wrong"; triesLeft: number }
  | { state: "too_many" | "expired" | "taken" | "stale" };

/**
 * Check a typed code. The attempt is claimed BEFORE the comparison, in one
 * atomic UPDATE ... RETURNING: parallel guesses cannot all read attempts = 0,
 * so at most 5 wrong guesses per code are ever evaluated, whatever the
 * request rate. Live codes for the account are tried together (a resend keeps
 * the earlier one alive), each with its own count.
 */
export async function confirmWithCode(userId: string, code: string, now = Date.now()): Promise<CodeResult> {
  const claimed = await db
    .prepare(
      `UPDATE email_verifications SET attempts = attempts + 1
        WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL AND expires_at > ? AND attempts < ?
        RETURNING link_hash, user_id, email, code_hash, created_at, expires_at, attempts, confirmed_at, dead_at`,
    )
    .all<VRow>(userId, now, CODE_MAX_ATTEMPTS);
  if (claimed.length === 0) {
    const last = await db
      .prepare(
        `SELECT expires_at FROM email_verifications
          WHERE user_id = ? AND confirmed_at IS NULL AND dead_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get<{ expires_at: number }>(userId);
    return { state: !last || Number(last.expires_at) <= now ? "expired" : "too_many" };
  }
  const want = hashCode(userId, code);
  let match: VRow | undefined;
  for (const r of claimed) if (sameHash(r.code_hash, want)) match = r; // no early exit: same work either way
  if (!match) {
    const newest = [...claimed].sort((a, b) => Number(b.created_at) - Number(a.created_at))[0];
    return { state: "wrong", triesLeft: Math.max(0, CODE_MAX_ATTEMPTS - Number(newest.attempts)) };
  }
  const used = await db
    .prepare("UPDATE email_verifications SET confirmed_at = ? WHERE link_hash = ? AND confirmed_at IS NULL AND dead_at IS NULL")
    .run(now, match.link_hash);
  if (used.changes < 1) return { state: "expired" }; // another request used it a moment ago
  const out = await applyRow(userId, match);
  return out.status === "confirmed" ? { state: "confirmed", user: out.user, wasPending: out.wasPending } : { state: out.status };
}

export type LinkState = "valid" | "confirmed" | "replaced" | "expired";

const LINK_SIGNIN_GRACE_MS = 15 * 60 * 1000;

async function linkRow(token: string): Promise<VRow | undefined> {
  return db.prepare("SELECT * FROM email_verifications WHERE link_hash = ?").get<VRow>(hashLink(token));
}

function stateOf(row: VRow | undefined, now: number): LinkState {
  if (!row) return "expired"; // unknown or pruned: nothing more honest to say
  if (row.confirmed_at != null) return "confirmed";
  if (row.dead_at != null) return "replaced";
  if (Number(row.expires_at) <= now) return "expired";
  return "valid";
}

/** What a link is, without using it: safe for a mail scanner's prefetch. */
export async function peekLink(token: string, now = Date.now()): Promise<{ state: LinkState; email: string | null }> {
  const row = await linkRow(token);
  return { state: stateOf(row, now), email: row ? maskEmail(row.email) : null };
}

export type LinkResult =
  /** userId: whose link it is; `signIn` is true only when this tap freshly lifted a signup wall. */
  | { state: "confirmed"; already: boolean; email: string; userId: string; signIn: boolean }
  | { state: "replaced" | "expired" | "taken" | "stale" };

/**
 * Use a link (the POST behind the Confirm button). Touches no session itself:
 * it says whether this tap freshly lifted a wall (`signIn`) and the route
 * signs the browser in. A used link (`already`) never signs in, or the mail
 * would be a reusable login.
 */
export async function consumeLink(token: string, now = Date.now()): Promise<LinkResult> {
  const row = await linkRow(token);
  const state = stateOf(row, now);
  if (!row) return { state: "expired" };
  // A mail scanner that runs scripts can confirm first (10-05: the page now confirms as it opens), so a reopen within
  // LINK_SIGNIN_GRACE_MS still signs in; after that a used link is never a login.
  if (state === "confirmed") {
    const fresh = now - Number(row.confirmed_at) < LINK_SIGNIN_GRACE_MS;
    return { state: "confirmed", already: true, email: maskEmail(row.email), userId: row.user_id, signIn: fresh };
  }
  if (state !== "valid") return { state };
  const used = await db
    .prepare("UPDATE email_verifications SET confirmed_at = ? WHERE link_hash = ? AND confirmed_at IS NULL AND dead_at IS NULL AND expires_at > ?")
    .run(now, row.link_hash, now);
  if (used.changes < 1) {
    // Lost a race with another tap or a code: say what the row is now.
    const again = stateOf(await linkRow(token), now);
    return again === "confirmed" ? { state: "confirmed", already: true, email: maskEmail(row.email), userId: row.user_id, signIn: false } : { state: again === "valid" ? "expired" : again };
  }
  const out = await applyRow(row.user_id, row);
  // Only a link that just lifted a signup wall signs in; an email-change link on an established account does not.
  return out.status === "confirmed"
    ? { state: "confirmed", already: false, email: maskEmail(row.email), userId: row.user_id, signIn: out.wasPending }
    : { state: out.status };
}

// --- address changes ----------------------------------------------------------

export interface EmailProblem {
  status: number;
  error: string;
  message: string;
}

/**
 * One validator for every new address a code can be sent to: signup-grade
 * (exactly one address, no throwaway inboxes), trimmed and lower-cased, and
 * not taken by another account.
 */
export async function checkNewEmail(raw: unknown, user: Pick<User, "id" | "email">): Promise<{ email: string } | EmailProblem> {
  const email = typeof raw === "string" ? normalize(raw) : "";
  if (!isValidEmail(email)) {
    return { status: 400, error: "invalid_email", message: "That doesn't look like an email address" };
  }
  if (isDisposableEmail(email)) {
    return { status: 400, error: "disposable_email", message: "Please use your real email address." };
  }
  if (email !== user.email) {
    const taken = await findUserByEmail(email);
    if (taken && taken.id !== user.id) {
      return { status: 409, error: "email_taken", message: "That email is already in use" };
    }
  }
  return { email };
}

/**
 * An established account (never walled) asks to move its sign-in email. The
 * new address gets a code; users.email does not change until it is typed, so
 * the old address keeps working meanwhile. A failed send changes nothing and
 * leaves no dangling code.
 */
export async function sendChangeCode(
  user: Pick<User, "id">,
  email: string,
): Promise<{ ok: true; email: string; expiresAt: number } | (EmailProblem & { ok: false })> {
  const { issued, send } = await issueAndDeliver(user, email);
  if (send.ok) return { ok: true, email: issued.email, expiresAt: issued.expiresAt };
  await killVerifications(user.id);
  const detail = send.err instanceof Error ? send.err.message : String(send.err);
  if (send.kind === "recipient") {
    await noteRefused(detail);
    return { ok: false, status: 400, error: "recipient_refused", message: "That address didn't accept our email. Check it and try again." };
  }
  await reportServerError(FAILED_SOURCE, new Error(`${send.kind}: ${detail} (email change not sent)`));
  return { ok: false, status: 503, error: "mail_unavailable", message: "We couldn't send the email. Try again in a few minutes." };
}

/**
 * A walled account fixes its address. That address was never proven, so it is
 * written now (login, the wall's "we sent it to ..." line and Send a New Code
 * all read users.email and agree); the wall stays until the new one confirms.
 */
export async function changePendingEmail(user: Pick<User, "id" | "email">, email: string): Promise<EmailProblem | null> {
  if (email === user.email) return null;
  try {
    const res = await db.prepare("UPDATE users SET email = ? WHERE id = ? AND email_pending = 1").run(email, user.id);
    if (res.changes < 1) return { status: 409, error: "not_pending", message: "This account no longer needs confirming" };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 409, error: "email_taken", message: "That email is already in use" };
    throw err;
  }
  // The free-trial rule follows the address the account will confirm (signupGuard.inboxKey).
  await db.prepare("UPDATE signup_log SET inbox_key = ? WHERE user_id = ?").run(inboxKey(email), user.id);
  // A reset link mailed to the old address must not survive the move: it
  // would let its holder set the password (and, before this, vouch for the
  // new address) on an account that no longer lives there.
  await revokeResetLinks(user.id);
  return null;
}

export type WalledSend =
  | { kind: "sent"; expiresAt: number }
  /** Our mail failed (or the day's budget is spent): the account was let in instead. */
  | { kind: "released" }
  /** The mail server refused the address: the wall stays so it can be corrected. */
  | { kind: "refused" }
  | { kind: "problem"; problem: EmailProblem };

/**
 * A walled account gets a code at `to`: its own address (Send a New Code) or
 * a new one (Change Email, saved first, see changePendingEmail). The one path
 * the resend route and the account page share.
 */
export async function sendWalledCode(user: User, to: string): Promise<WalledSend> {
  const problem = await changePendingEmail(user, to);
  if (problem) return { kind: "problem", problem };
  const { issued, send } = await issueAndDeliver(user, to, { linkOnly: true });
  if (send.ok) return { kind: "sent", expiresAt: issued.expiresAt };
  return { kind: (await settleFailedSend(user, send, issued)) === "kept" ? "refused" : "released" };
}

// --- limits and payloads ------------------------------------------------------

/** "Wait 24 seconds", "about 40 minutes" or "about 20 hours": never a raw "3421s". */
export function waitMessage(seconds: number): string {
  if (seconds < 90) return `Wait ${seconds} second${seconds === 1 ? "" : "s"}, then try again.`;
  if (seconds < 90 * 60) return `Too many tries. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  const hours = Math.ceil(seconds / 3600);
  return `Too many tries. Try again in about ${hours} hours.`;
}

/**
 * Run rate limits in order (memory, then the shared counter); the first one
 * that trips answers a 429 with a readable wait. Null = go ahead.
 */
export async function limitWithMessage(keys: Array<[string, RateLimitRule[]]>): Promise<Response | null> {
  for (const [key, rules] of keys) {
    const limited = await limitOrRespondAsync(key, rules);
    if (limited) {
      const body = (await limited.json().catch(() => null)) as { retryAfterSeconds?: number } | null;
      const seconds = Math.max(1, Number(body?.retryAfterSeconds ?? 60));
      return Response.json(
        { error: "slow_down", message: waitMessage(seconds), retryAfterSeconds: seconds },
        { status: 429, headers: { "Retry-After": String(seconds) } },
      );
    }
  }
  return null;
}

/**
 * One network's daily allowance of mailed codes (signup, resend and Change
 * Email together). The shared mailbox has a day's budget (CONFIRM_MAIL_DAY_
 * BUDGET) past which every signup is released unconfirmed; without a per-IP
 * share one script could spend it and switch the wall off for everyone. Call
 * it right before a request would mail a code. Null = go ahead.
 */
export async function limitCodeMail(req: Request): Promise<Response | null> {
  return limitWithMessage([[`auth:code:day:${clientIp(req)}`, LIMITS.emailCodeIpDay]]);
}

export type SessionPublicUser = PublicUser & { emailCodeExpiresAt?: number | null };

/** toPublicUser plus, for a walled account only, when its newest code stops working. */
export async function publicUserWithEmailState(user: User): Promise<SessionPublicUser> {
  const pub = toPublicUser(user);
  if (!pub.mustConfirmEmail) return pub;
  return { ...pub, emailCodeExpiresAt: (await liveVerification(user.id))?.expiresAt ?? null };
}

// --- signup -------------------------------------------------------------------

export interface SignupConfirmation {
  /** The account as it stands now: released ones are no longer pending. */
  user: User;
  /** A code is on its way (or already was). */
  emailSent: boolean;
  /** "recipient": the mail server refused the address; the wall stays so the user can correct it. */
  problem: "recipient" | null;
  expiresAt: number | null;
}

/**
 * Right after a pending account is created: issue its code and mail it, and
 * settle any failure. Never throws and never strands the account: a broken
 * mail server, a timeout, a spent daily budget or a database hiccup releases
 * it (and reports); only a refused address keeps the wall.
 */
export async function startSignupConfirmation(user: User): Promise<SignupConfirmation> {
  try {
    const { issued, send } = await issueAndDeliver(user, user.email, { linkOnly: true });
    if (send.ok) return { user, emailSent: true, problem: null, expiresAt: issued.expiresAt };
    if ((await settleFailedSend(user, send, issued)) === "kept") return { user, emailSent: false, problem: "recipient", expiresAt: null };
  } catch (err) {
    await reportServerError(FAILED_SOURCE, err);
    await markEmailConfirmed(user.id, { verified: false, email: user.email });
  }
  return { user: (await findUserById(user.id)) ?? { ...user, emailPending: false }, emailSent: false, problem: null, expiresAt: null };
}

// --- admin --------------------------------------------------------------------

export interface EmailConfirmStats {
  /** The switch, as the owner set it. */
  on: boolean;
  /** Can this server deliver a code at all (SMTP configured, or the dev echo)? */
  deliverable: boolean;
  waiting: number;
  sentToday: number;
  dayBudget: number;
  /**
   * Errors-page entries from source "email-confirm" in the last 24 hours:
   * accounts released instead of walled, and change-email sends that failed.
   * Anything above zero means the mailbox needs a look.
   */
  failedLast24h: number;
  /** Addresses the mail server refused in the last 24 hours (people's typos; a sudden burst is not). */
  refusedLast24h: number;
}

export async function emailConfirmStats(now = Date.now()): Promise<EmailConfirmStats> {
  const n = async (sql: string, ...args: (string | number)[]) => Number(((await db.prepare(sql).get<{ n: number }>(...args)) ?? { n: 0 }).n);
  return {
    on: await emailConfirmSwitchOn(),
    deliverable: emailConfirmActive(),
    waiting: await n("SELECT COUNT(*) AS n FROM users WHERE email_pending = 1"),
    sentToday: await dayBudgetUsed(CONFIRM_MAIL_BUDGET_NAME),
    dayBudget: CONFIRM_MAIL_DAY_BUDGET,
    failedLast24h: await n("SELECT COUNT(*) AS n FROM error_events WHERE source = ? AND at > ?", FAILED_SOURCE, now - 24 * 60 * 60 * 1000),
    refusedLast24h: await n("SELECT COUNT(*) AS n FROM error_events WHERE source = ? AND at > ?", REFUSED_SOURCE, now - 24 * 60 * 60 * 1000),
  };
}
