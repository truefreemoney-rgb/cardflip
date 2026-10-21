import "server-only";
import { db } from "@/lib/db";
import { LIMITS, RateLimitError, clientIp, enforceRateLimit, limitOrRespond, rateLimitResponse, type RateLimitRule, type RuleUse } from "@/lib/server/rateLimit";

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

// ---------------------------------------------------------------------------
// Shut-out (Chris 10-20, after a bot on one AWS IP made 7 accounts and tried every account route in 9 minutes):
// an IP that probes is refused on every sign-in, sign-up and account route for a day. Kept as a 24 h row in
// rate_limits, so the hourly sweep clears it like any other window. Loopback and "unknown" are never shut out
// (same rule as signupGuard.hashIp: CI and tests come from there, and "unknown" would pool everyone).

const SHUT_OUT_MS = 24 * 60 * 60 * 1000;
const HOUR: RateLimitRule = { limit: 0, windowMs: 60 * 60 * 1000 };
/** Made-up addresses one IP may try at sign-in in an hour; this many shuts it out (a person mistypes one or two). */
export const GHOST_LOGINS_PER_HOUR = 5;
const SHUT_OUT_MESSAGE = "Too many tries from this network. Try again tomorrow, or email support@cardflip.io.";

const shutOutKey = (ip: string) => `shutout:${ip}|${SHUT_OUT_MS}`;
const realIp = (ip: string) => Boolean(ip) && ip !== "unknown" && !/^(127\.|::1$|::ffff:127\.)/.test(ip);

/** Shut `ip` out for a day from now. Logged as a warning, so it lands on /admin/errors. Best effort. */
export async function shutOutIp(ip: string, reason: string, now = Date.now()): Promise<void> {
  if (!realIp(ip)) return;
  try {
    await db
      .prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = count + 1, window_start = excluded.window_start`,
      )
      .run(shutOutKey(ip), now);
    console.warn(`ip shut out for 24 h: ${ip} (${reason})`);
  } catch (err) {
    console.error("shut-out could not be written:", err);
    return;
  }
  // Chris is emailed, so nobody has to watch /admin (10-20). Capped per day; after the response.
  const { securityAlertLater } = await import("@/lib/server/securityAlert");
  await securityAlertLater({ ip, reason, at: now });
}

/** Seconds left on `ip`'s shut-out, or 0. Fails open, like the limiter. */
export async function shutOutLeft(ip: string, now = Date.now()): Promise<number> {
  if (!realIp(ip)) return 0;
  try {
    const row = await db.prepare("SELECT window_start FROM rate_limits WHERE key = ?").get<{ window_start: number }>(shutOutKey(ip));
    const left = row ? Number(row.window_start) + SHUT_OUT_MS - now : 0;
    return left > 0 ? Math.ceil(left / 1000) : 0;
  } catch {
    return 0;
  }
}

/** The 429 a shut-out IP gets, or null. For routes whose own limits are not keyed `${scope}:${ip}` (ipGate is). */
export async function shutOutResponse(req: Request): Promise<Response | null> {
  const left = await shutOutLeft(clientIp(req));
  return left > 0 ? Response.json({ error: SHUT_OUT_MESSAGE, retryAfterSeconds: left }, { status: 429, headers: { "Retry-After": String(left) } }) : null;
}

const TOR_MESSAGE = "Sign-in isn't available over Tor. Turn it off and try again, or email support@cardflip.io.";

/** The 403 a Tor exit gets (lib/server/torExits.ts, 10-21), or null. */
export async function torResponse(req: Request): Promise<Response | null> {
  const { isTorExit } = await import("@/lib/server/torExits");
  return (await isTorExit(clientIp(req))) ? Response.json({ error: TOR_MESSAGE }, { status: 403 }) : null;
}

/** The per-IP guard every sign-in, sign-up, account and billing route opens with: the shut-out, Tor, then authAttempt on `${scope}:${ip}`. */
export async function ipGate(req: Request, scope: string): Promise<Response | null> {
  return (await shutOutResponse(req)) ?? (await torResponse(req)) ?? (await limitOrRespondAsync(`${scope}:${clientIp(req)}`, LIMITS.authAttempt));
}

// ---------------------------------------------------------------------------
// Site-wide alarm (10-21, after a Tor bot changed IP every few requests: no single IP reached a shut-out, so nobody was
// told and Chris found 16 junk accounts in /admin himself). Counted across every network; the hour's SPIKE_PER_HOUR-th
// event emails support@ once (securityAlert, inside its daily cap). It blocks nothing by itself. Normal traffic 08-22..
// 10-21: at most 5 sign-ups in an hour, 10 in a day.

export const SPIKE_PER_HOUR = { ghostLogin: 10, newAccount: 8, refusedSignup: 10 } as const;
export type SpikeKind = keyof typeof SPIKE_PER_HOUR;
const SPIKE_WORDS: Record<SpikeKind, string> = {
  ghostLogin: "made-up email addresses tried at sign-in",
  newAccount: "new accounts",
  refusedSignup: "sign-ups refused (throwaway, look-alike or invalid address)",
};

/** One event toward the site-wide alarm. Callers skip loopback/unknown (tests and CI). Best effort, never throws. */
export async function noteSpike(kind: SpikeKind, now = Date.now()): Promise<void> {
  try {
    const { count } = await hit(`spike:${kind}`, HOUR, now);
    if (count !== SPIKE_PER_HOUR[kind]) return;
    const { securityAlertLater } = await import("@/lib/server/securityAlert");
    await securityAlertLater({ ip: "many networks", reason: `${count} ${SPIKE_WORDS[kind]} within an hour`, at: now, spike: true });
  } catch {
    // Advisory: every per-IP limit still applies.
  }
}

/**
 * A sign-in for an address with no account. The GHOST_LOGINS_PER_HOUR-th different one from an IP in an hour
 * shuts it out (the 10-20 bot tried admin@, info@, support@ and made-up addresses). Best effort.
 */
export async function noteGhostLogin(ip: string, email: string, now = Date.now()): Promise<void> {
  if (!realIp(ip)) return;
  try {
    if ((await hit(`auth:ghost:${ip}:${email.toLowerCase()}`, HOUR, now)).count !== 1) return;
    await noteSpike("ghostLogin", now);
    const { count } = await hit(`auth:ghosts:${ip}`, HOUR, now);
    if (count >= GHOST_LOGINS_PER_HOUR) await shutOutIp(ip, `${count} made-up emails at sign-in`, now);
  } catch {
    // Advisory: the per-IP and per-account limits still apply.
  }
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
