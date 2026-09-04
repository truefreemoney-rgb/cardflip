import "server-only";
import { monthlyScans } from "@/lib/server/users";
import { db } from "@/lib/db";
import { LEGACY_DAILY_SCANS, TRIAL_SCANS, scanTier, type User } from "@/lib/server/users";

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
// Legacy accounts are metered per DAY; the day key shares the scan_month
// column (it's just the counter's period label).
const day = () => new Date().toISOString().slice(0, 10);

export interface ScanQuota {
  used: number;
  included: number;
  /** null = not enforced for this user (not a subscriber). */
  remaining: number | null;
}

export function scanQuota(user: User): ScanQuota {
  const tier = scanTier(user);
  if (tier === "trial") {
    // Free trial: a lifetime allowance, not a monthly one.
    const t = user.trialScansUsed ?? 0;
    return { used: t, included: TRIAL_SCANS, remaining: Math.max(0, TRIAL_SCANS - t) };
  }
  if (tier === "legacy") {
    const used = user.scanMonth === day() ? user.scansUsed : 0;
    return { used, included: LEGACY_DAILY_SCANS, remaining: Math.max(0, LEGACY_DAILY_SCANS - used) };
  }
  if (tier === "owner") {
    const used = user.scanMonth === month() ? user.scansUsed : 0;
    return { used, included: 0, remaining: null }; // null = not enforced
  }
  const used = user.scanMonth === month() ? user.scansUsed : 0;
  const cap = monthlyScans(user);
  return {
    used,
    included: cap,
    remaining: Math.max(0, cap - used),
  };
}

/** True when a subscriber has exhausted the month's allowance. */
export function scanQuotaExhausted(user: User): boolean {
  const q = scanQuota(user);
  return q.remaining !== null && q.remaining <= 0;
}

/** Count one scan, resetting the counter on month rollover. Answers the
 * post-scan quota so the scan response can carry usage without a re-read. */
export async function recordScan(user: User): Promise<ScanQuota> {
  const tier = scanTier(user);
  if (tier === "trial") {
    const t = (user.trialScansUsed ?? 0) + 1;
    await db.prepare("UPDATE users SET trial_scans_used = ? WHERE id = ?").run(t, user.id);
    return { used: t, included: TRIAL_SCANS, remaining: Math.max(0, TRIAL_SCANS - t) };
  }
  if (tier === "legacy") {
    const d = day();
    const used = (user.scanMonth === d ? user.scansUsed : 0) + 1;
    await db.prepare("UPDATE users SET scan_month = ?, scans_used = ? WHERE id = ?").run(d, used, user.id);
    return { used, included: LEGACY_DAILY_SCANS, remaining: Math.max(0, LEGACY_DAILY_SCANS - used) };
  }
  if (tier === "owner") {
    const m = month();
    const used = (user.scanMonth === m ? user.scansUsed : 0) + 1;
    await db.prepare("UPDATE users SET scan_month = ?, scans_used = ? WHERE id = ?").run(m, used, user.id);
    return { used, included: 0, remaining: null };
  }
  const m = month();
  const used = (user.scanMonth === m ? user.scansUsed : 0) + 1;
  await db.prepare("UPDATE users SET scan_month = ?, scans_used = ? WHERE id = ?").run(m, used, user.id);
  const cap = monthlyScans(user);
  return {
    used,
    included: cap,
    remaining: Math.max(0, cap - used),
  };
}
