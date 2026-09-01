import "server-only";
import { db } from "@/lib/db";
import { isSubscribed, type User } from "@/lib/server/users";

/**
 * Scan metering. The subscription includes MONTHLY_SCANS per calendar month
 * (UTC); the counter resets lazily on month rollover. Chris scrapped the
 * extra-scan packs (09-01) — one plan, one allowance; the users.extra_scans
 * column stays in the schema, dormant, in case packs ever return.
 *
 * The cap is enforced only for subscribers today: early access is free and
 * ungated (rate limits in rateLimit.ts still bound abuse), and how free
 * accounts get limited at launch is an open product decision. Usage is
 * metered for everyone so that decision can be made with data.
 */

export const MONTHLY_SCANS = 500;

const month = () => new Date().toISOString().slice(0, 7);

export interface ScanQuota {
  used: number;
  included: number;
  /** null = not enforced for this user (not a subscriber). */
  remaining: number | null;
}

export function scanQuota(user: User): ScanQuota {
  const used = user.scanMonth === month() ? user.scansUsed : 0;
  return {
    used,
    included: MONTHLY_SCANS,
    remaining: isSubscribed(user) ? Math.max(0, MONTHLY_SCANS - used) : null,
  };
}

/** True when a subscriber has exhausted the month's allowance. */
export function scanQuotaExhausted(user: User): boolean {
  const q = scanQuota(user);
  return q.remaining !== null && q.remaining <= 0;
}

/** Count one scan, resetting the counter on month rollover. */
export async function recordScan(user: User): Promise<void> {
  const m = month();
  const used = user.scanMonth === m ? user.scansUsed : 0;
  await db.prepare("UPDATE users SET scan_month = ?, scans_used = ? WHERE id = ?").run(m, used + 1, user.id);
}
