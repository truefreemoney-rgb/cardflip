import "server-only";
import { monthlyScans, scanQuota, type ScanQuota } from "@/lib/server/users";
import { db } from "@/lib/db";
import { LEGACY_DAILY_SCANS, PLAN_SCANS, TRIAL_SCANS, scanTier, type User } from "@/lib/server/users";

// scanQuota itself lives in users.ts now (toPublicUser ships it to the
// header counter); this module keeps the writes and the exhaustion check.
export { scanQuota, type ScanQuota };

/**
 * Scan metering. A subscription includes the plan's monthly cap (calendar
 * month, UTC; the counter resets lazily on rollover), then invite-a-friend
 * bonus scans, then Scan Pack scans (users.extra_scans, one-time buys that
 * never expire). An account with no subscription and a pack balance is the
 * "pack" tier: the balance is its whole allowance. Numbers: lib/pricing.ts.
 */

/** @deprecated read PLAN_SCANS.standard (lib/pricing.ts is the source). */
export const MONTHLY_SCANS = PLAN_SCANS.standard;

const month = () => new Date().toISOString().slice(0, 7);
// Legacy accounts are metered per DAY; the day key shares the scan_month
// column (it's just the counter's period label).
const day = () => new Date().toISOString().slice(0, 10);

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
  if (tier === "pack") {
    const pack = Math.max(0, (user.extraScans ?? 0) - 1);
    await db.prepare("UPDATE users SET extra_scans = ? WHERE id = ?").run(pack, user.id);
    return { used: 0, included: pack + 1, remaining: pack, pack };
  }
  const m = month();
  const cap = monthlyScans(user);
  const before = user.scanMonth === m ? user.scansUsed : 0;
  let bonus = user.bonusScans ?? 0;
  let pack = user.extraScans ?? 0;
  // The month's allowance goes first; invite-a-friend scans are spent only
  // once it is gone, so they never evaporate at the month rollover; Scan
  // Pack scans (never expire) go last.
  if (before >= cap && bonus > 0) {
    bonus -= 1;
    await db.prepare("UPDATE users SET scan_month = ?, scans_used = ?, bonus_scans = ? WHERE id = ?").run(m, before, bonus, user.id);
    return { used: before, included: cap, remaining: bonus + pack, bonus, pack };
  }
  if (before >= cap && pack > 0) {
    pack -= 1;
    await db.prepare("UPDATE users SET scan_month = ?, scans_used = ?, extra_scans = ? WHERE id = ?").run(m, before, pack, user.id);
    return { used: before, included: cap, remaining: pack, bonus, pack };
  }
  const used = before + 1;
  await db.prepare("UPDATE users SET scan_month = ?, scans_used = ? WHERE id = ?").run(m, used, user.id);
  return {
    used,
    included: cap,
    remaining: Math.max(0, cap - used) + bonus + pack,
    bonus,
    pack,
  };
}
