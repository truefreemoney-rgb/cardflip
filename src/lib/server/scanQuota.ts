import "server-only";
import { db } from "@/lib/db";
import { isSubscribed, type User } from "@/lib/server/users";

/**
 * Scan metering. The subscription includes MONTHLY_SCANS per calendar month
 * (UTC); scan packs add PACK_SCANS to a purchased bank that is consumed only
 * after the monthly allowance runs out — the bank carries over until used
 * (expiring paid credit punishes exactly the people who paid extra).
 *
 * The cap is enforced only for subscribers today: early access is free and
 * ungated (rate limits in rateLimit.ts still bound abuse), and how free
 * accounts get limited at launch is an open product decision. Usage is
 * metered for everyone so that decision can be made with data.
 */

export const MONTHLY_SCANS = 500;
export const PACK_SCANS = 150;

const month = () => new Date().toISOString().slice(0, 7);

export interface ScanQuota {
  used: number;
  included: number;
  extra: number;
  /** null = not enforced for this user (not a subscriber). */
  remaining: number | null;
}

export function scanQuota(user: User): ScanQuota {
  const used = user.scanMonth === month() ? user.scansUsed : 0;
  const extra = user.extraScans;
  return {
    used,
    included: MONTHLY_SCANS,
    extra,
    remaining: isSubscribed(user) ? Math.max(0, MONTHLY_SCANS + extra - used) : null,
  };
}

/** True when a subscriber has exhausted the month and the bank. */
export function scanQuotaExhausted(user: User): boolean {
  const q = scanQuota(user);
  return q.remaining !== null && q.remaining <= 0;
}

/**
 * Count one scan. Resets the counter on month rollover; once past the
 * monthly allowance, subscribers burn one banked pack scan per call.
 */
export async function recordScan(user: User): Promise<void> {
  const m = month();
  const used = user.scanMonth === m ? user.scansUsed : 0;
  const burnExtra = isSubscribed(user) && used >= MONTHLY_SCANS && user.extraScans > 0;
  await db
    .prepare(
      "UPDATE users SET scan_month = ?, scans_used = ?, extra_scans = MAX(0, extra_scans - ?) WHERE id = ?",
    )
    .run(m, used + 1, burnExtra ? 1 : 0, user.id);
}

export async function addExtraScans(userId: string, count: number): Promise<void> {
  await db.prepare("UPDATE users SET extra_scans = extra_scans + ? WHERE id = ?").run(count, userId);
}
