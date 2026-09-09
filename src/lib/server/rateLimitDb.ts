import "server-only";
import { db } from "@/lib/db";
import { LIMITS, RateLimitError, limitOrRespond, rateLimitResponse, type RateLimitRule } from "@/lib/server/rateLimit";

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

/** One atomic hit against `key` for `rule`; returns the window's count and start. */
async function hit(key: string, rule: RateLimitRule, now: number): Promise<{ count: number; window_start: number }> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start + ? <= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start + ? <= ? THEN ? ELSE window_start END
       RETURNING count, window_start`,
    )
    .get<{ count: number; window_start: number }>(
      `${key}|${rule.windowMs}`, now,
      rule.windowMs, now,
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

/** Tests only. */
export function _resetRateLimitDb(): void {
  warned = false;
  lastSweep = 0;
}
