// No "server-only" marker on purpose: the module has no server deps and the
// test suite (scripts/test-rate-limit.mjs) imports it straight into node.

/**
 * Process-local fixed-window rate limiter.
 *
 * CardFlip runs as a single Fly machine, so an in-memory map is the whole
 * truth; if the app ever scales past one machine this needs to move to the
 * DB (a `rate_limits` table) or the limits become per-machine. Windows are
 * keyed by an arbitrary string — the caller decides whether that's a user
 * id, an IP, or a route+user combo — so the same helper protects a paid
 * upstream (Anthropic vision) per account and a public route per IP.
 */

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Too many requests");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type RateLimitRule = {
  /** Max hits per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Every so often drop expired windows so a long-running process doesn't
// accumulate one entry per IP that ever hit the site.
let lastSweep = 0;
const SWEEP_EVERY_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Count one hit against `key`. Throws RateLimitError once the window's limit
 * is exceeded; the hit that trips the limit is not counted as served.
 * Multiple rules (e.g. per-minute AND per-day) are checked in order.
 */
export function enforceRateLimit(key: string, ...rules: RateLimitRule[]): void {
  const now = Date.now();
  sweep(now);
  const rulesToTake: [string, Bucket][] = [];
  for (const rule of rules) {
    const bucketKey = `${key}|${rule.windowMs}`;
    let b = buckets.get(bucketKey);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + rule.windowMs };
      buckets.set(bucketKey, b);
    }
    if (b.count >= rule.limit) {
      throw new RateLimitError(Math.max(1, Math.ceil((b.resetAt - now) / 1000)));
    }
    rulesToTake.push([bucketKey, b]);
  }
  // Only consume when every rule allowed it, so a per-day refusal doesn't
  // still eat the per-minute budget.
  for (const [, b] of rulesToTake) b.count += 1;
}

/** Best-effort client IP behind Fly's proxy; falls back to a shared bucket. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("fly-client-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

/** Standard 429 payload so every route answers the same way. */
export function rateLimitResponse(err: RateLimitError): Response {
  return Response.json(
    {
      error: `Too many requests — try again in ${err.retryAfterSeconds}s`,
      retryAfterSeconds: err.retryAfterSeconds,
    },
    { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } },
  );
}

/**
 * One-liner for routes without a shared try/catch: returns the 429 to send,
 * or null when the request is within budget.
 */
export function limitOrRespond(key: string, rules: RateLimitRule[]): Response | null {
  try {
    enforceRateLimit(key, ...rules);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Per-route budgets. Vision is the only one that costs real money per call,
 * so it gets a daily cap on top of the burst cap; a scanning session is a
 * few calls a minute, so 30/min leaves headroom for auto-scan retries.
 */
export const LIMITS = {
  visionScan: [
    { limit: 30, windowMs: MINUTE },
    { limit: 500, windowMs: DAY },
  ] as RateLimitRule[],
  /** The shared demo login is public — keep it from draining the credit. */
  visionScanDemo: [
    { limit: 10, windowMs: MINUTE },
    { limit: 60, windowMs: DAY },
  ] as RateLimitRule[],
  ebayComps: [{ limit: 60, windowMs: MINUTE }] as RateLimitRule[],
  /** Per-user burst guard on PSA cert lookups. */
  psaCert: [{ limit: 10, windowMs: MINUTE }] as RateLimitRule[],
  /** PSA's free tier is 100 calls/day for the whole app — keep 20 in reserve. */
  psaCertGlobal: [{ limit: 80, windowMs: DAY }] as RateLimitRule[],
  /** Unauthenticated (landing ticker uses it) — per IP, generous. */
  searchCard: [{ limit: 120, windowMs: MINUTE }] as RateLimitRule[],
  /** Sign-in / signup / reset: brute-force backstop, per IP. */
  authAttempt: [{ limit: 20, windowMs: 10 * MINUTE }] as RateLimitRule[],
};

/** Reset all windows — for tests only. */
export function _resetRateLimits() {
  buckets.clear();
  lastSweep = 0;
}
