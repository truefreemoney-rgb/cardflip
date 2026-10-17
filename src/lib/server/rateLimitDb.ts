import "server-only";
import { db } from "@/lib/db";
import { LIMITS, RateLimitError, enforceRateLimit, limitOrRespond, rateLimitResponse, type RateLimitRule, type RuleUse } from "@/lib/server/rateLimit";

/**
 * DB-backed fixed-window limiter for the auth brute-force guard.
 *
 * rateLimit.ts is per-process memory. On Vercel every function instance has
 * its own map, so a password-guessing client that spread requests across
 * instances (or just waited for cold starts) was never actually bounded.
 * Same fix as dayBudget.ts: count in a table (`rate_limits`, db.ts) so the
 * window spans instances. The memory limiter still runs first as the cheap
 * burst guard on a warm instance.
 *
 * Fails OPEN: if the counter table is unreachable the request proceeds
 * (logged once per process). Never lock everyone out of login because a
 * side table is down — the password check is still the real gate.
 */

let warned = false;
let lastSweep = 0;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/** One atomic hit (`by` hits at once) against `key` for `rule`; returns the window's count and start. */
async function hit(key: string, rule: RateLimitRule, now: number, by = 1): Promise<{ count: number; window_start: number }> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start + ? <= ? THEN ? ELSE count + ? END,
         window_start = CASE WHEN window_start + ? <= ? THEN ? ELSE window_start END
       RETURNING count, window_start`,
    )
    .get<{ count: number; window_start: number }>(
      `${key}|${rule.windowMs}`, by, now,
      rule.windowMs, now, by, by,
      rule.windowMs, now, now,
    );
  if (!row) throw new Error("rate_limits upsert returned no row");
  return { count: Number(row.count), window_start: Number(row.window_start) };
}

async function sweep(now: number): Promise<void> {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  try {
    // Nothing keeps a window longer than a day (LIMITS), so anything older is dead.
    await db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(now - 24 * 60 * 60 * 1000);
  } catch {
    // Hygiene only.
  }
}

/**
 * Durable check: throws RateLimitError once the count for any rule passes
 * its limit in the current window. Unlike the memory limiter the refused
 * hit is counted (it's already written by the upsert); for a fixed window
 * that changes nothing about when it reopens.
 */
export async function enforceRateLimitDb(key: string, rules: RateLimitRule[], now = Date.now()): Promise<void> {
  await sweep(now);
  for (const rule of rules) {
    const { count, window_start } = await hit(key, rule, now);
    if (count > rule.limit) {
      throw new RateLimitError(Math.max(1, Math.ceil((window_start + rule.windowMs - now) / 1000)));
    }
  }
}

/**
 * Drop-in for limitOrRespond on the auth routes (login / forgot / reset /
 * admin login / password change): memory first, then the shared counter.
 * Returns the 429 to send, or null.
 */
export async function limitOrRespondAsync(key: string, rules: RateLimitRule[] = LIMITS.authAttempt): Promise<Response | null> {
  const local = limitOrRespond(key, rules);
  if (local) return local;
  try {
    await enforceRateLimitDb(key, rules);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    if (!warned) {
      warned = true;
      console.error("rate_limits counter unavailable — auth limiter is memory-only until it recovers:", err);
    }
    return null;
  }
}

/**
 * From this share of a rule's budget seen on one instance, that instance counts the key in
 * the shared table too. A visitor reading a few pages never writes a row.
 */
export const SHARED_FROM = 0.25;

/**
 * Busy public routes (search, catalog reads, price history, share pictures; task #29, 10-17):
 * the memory window decides alone until one instance has seen SHARED_FROM of a rule's
 * budget from this key. From then on every hit also goes to `rate_limits`, the first one
 * carrying the hits this instance had already served (bucket.synced), so the shared count
 * is the real total once a client is busy anywhere. Spread thin across K instances a client
 * gets at most K x SHARED_FROM of a budget unseen before the shared window binds, against
 * an unbounded K x budget before. Fails open like the auth limiter.
 */
export async function limitOrRespondShared(key: string, rules: RateLimitRule[], now = Date.now()): Promise<Response | null> {
  let uses: RuleUse[];
  try {
    uses = enforceRateLimit(key, ...rules);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }
  try {
    await sweep(now);
    for (const { rule, bucket } of uses) {
      if (bucket.count < Math.ceil(rule.limit * SHARED_FROM)) continue;
      const by = bucket.count - (bucket.synced ?? 0);
      if (by <= 0) continue;
      const { count, window_start } = await hit(key, rule, now, by);
      bucket.synced = bucket.count;
      if (count > rule.limit) return rateLimitResponse(new RateLimitError(Math.max(1, Math.ceil((window_start + rule.windowMs - now) / 1000))));
    }
    return null;
  } catch (err) {
    if (!warned) {
      warned = true;
      console.error("rate_limits counter unavailable — public limiter is memory-only until it recovers:", err);
    }
    return null;
  }
}

/** Tests only. */
export function _resetRateLimitDb(): void {
  warned = false;
  lastSweep = 0;
}

/**
 * Guess limit on one account (login, signup resume, console login). 10 tries per 15 min count per account + IP, so a
 * stranger's bad passwords lock out only the stranger (10-16 audit); the account-wide cap (100 an hour) still stops a
 * guesser rotating IPs. The wide counter is only spent once the per-IP one lets the try through.
 */
export async function accountLockout(scope: string, account: string, ip: string): Promise<Response | null> {
  const acct = account.toLowerCase();
  return (
    (await limitOrRespondAsync(`${scope}:acct:${acct}:${ip}`, LIMITS.authAccount)) ??
    (await limitOrRespondAsync(`${scope}:acct:${acct}`, LIMITS.authAccountWide))
  );
}
