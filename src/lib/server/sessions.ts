import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Sessions are sliding, not fixed: a seller who opens the app at least once
 * a month only logs in again once a year (SESSION_MAX_AGE_MS). Every session starts 30 days out, and
 * `touchSession` pushes it another 30 days whenever the app checks the
 * signed-in user (each app page load) — throttled to once a day so the
 * cookie isn't rewritten on every request. On a phone this is what "stay
 * logged in" means; the cookie itself is a persistent one with the same
 * expiry (see sessionCookieOptions), never a browser-session cookie.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/**
 * The slide stops here (#31, audit 10-16): a year after the sign-in that made
 * it, a session ends however often it was used, so a cookie copied off a
 * device can't live forever. Sliding still covers everyday use.
 */
export const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
/** Don't bother renewing more often than this. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000; // 1 day

export interface SessionInfo {
  token: string;
  expiresAt: number;
}

/**
 * What sits in sessions.token: "h:" + the SHA-256 of the cookie value, never
 * the cookie value itself, so a read of the table hands out nothing that
 * works as a cookie (same idea as password_resets.token_hash).
 */
export function sessionKey(token: string): string {
  return "h:" + createHash("sha256").update(token).digest("hex");
}

/** The shape of every cookie value createSession has ever issued. */
const ISSUED_TOKEN = /^[0-9a-f]{64}$/;

interface SessionRow {
  user_id: string;
  created_at: number;
  expires_at: number;
}

/** The latest a session made at `createdAt` may run to. */
const hardEnd = (createdAt: number) => Number(createdAt) + SESSION_MAX_AGE_MS;

/**
 * The row behind a cookie value. Rows written before hashing hold the cookie
 * value itself; the first time such a cookie shows up its row is rewritten to
 * the hash. Only a value shaped like a cookie we issued gets that fallback,
 * so a hash read out of the table ("h:…") can never be replayed as a cookie.
 */
async function findSession(token: string): Promise<(SessionRow & { key: string }) | null> {
  const key = sessionKey(token);
  const find = async () =>
    (await db.prepare("SELECT user_id, created_at, expires_at FROM sessions WHERE token = ?").get(key)) as
      | SessionRow
      | undefined;
  let row = await find();
  if (!row && ISSUED_TOKEN.test(token)) {
    await db.prepare("UPDATE sessions SET token = ? WHERE token = ?").run(key, token);
    // Read again whatever the update reports: a parallel request may have
    // been the one that rewrote the row.
    row = await find();
  }
  return row ? { ...row, key } : null;
}

export async function createSession(userId: string): Promise<SessionInfo> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  await db
    .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sessionKey(token), userId, now, expiresAt);

  return { token, expiresAt };
}

/**
 * When a live session runs out, or null for an unknown / expired token. The
 * app-to-website handoff (api/auth/app-cookie) needs it to give the cookie
 * the same end date the session already has.
 */
export async function sessionExpiresAt(token: string): Promise<number | null> {
  const row = await findSession(token);
  if (!row) return null;
  const end = Math.min(row.expires_at, hardEnd(row.created_at));
  return end > Date.now() ? end : null;
}

export async function getSessionUserId(token: string): Promise<string | null> {
  const row = await findSession(token);
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now || hardEnd(row.created_at) < now) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").run(row.key);
    return null;
  }
  return row.user_id;
}

/**
 * Slide a live session's expiry out to a fresh 30 days. Returns the new
 * expiry when it actually renewed (caller re-sets the cookie to match), or
 * null when the session is young enough that nothing changed.
 */
export async function touchSession(token: string): Promise<SessionInfo | null> {
  const row = await findSession(token);
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) return null;
  if (row.expires_at > now + SESSION_TTL_MS - RENEW_AFTER_MS) return null;
  const expiresAt = Math.min(now + SESSION_TTL_MS, hardEnd(row.created_at));
  if (expiresAt <= row.expires_at) return null; // already at the year's end: nothing to slide

  await db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(expiresAt, row.key);
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  const row = await findSession(token);
  if (row) await db.prepare("DELETE FROM sessions WHERE token = ?").run(row.key);
}

/**
 * "Sign out everywhere else" / after a password change: drop every session
 * for the user except the one making the request. Returns how many went.
 */
export async function destroyOtherSessions(userId: string, keepToken: string | null): Promise<number> {
  // findSession first, so a caller still on a pre-hashing row keeps its seat.
  const keep = keepToken ? await findSession(keepToken) : null;
  const res = keep
    ? await db.prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?").run(userId, keep.key)
    : await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return Number(res.changes);
}

/**
 * The one cookie shape every issuer uses (login, signup, demo, reset,
 * renewal). Persistent (`expires`), httpOnly, Lax so the eBay OAuth
 * callback and email links land signed in, Secure in production.
 */
export function sessionCookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  };
}
