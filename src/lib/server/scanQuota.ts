import "server-only";
import { db } from "@/lib/db";
import { PRICE } from "@/lib/pricing";
import { etDate } from "@/lib/time";
import { ensurePlanSeed } from "@/lib/server/scanCredits";
import {
  LEGACY_DAILY_SCANS,
  PLAN_SCANS,
  TRIAL_SCANS,
  findUserById,
  isComped,
  monthlyScans,
  planOf,
  scanQuota,
  scanTier,
  spendsPlanScans,
  type ScanQuota,
  type User,
} from "@/lib/server/users";

// scanQuota itself lives in users.ts now (toPublicUser ships it to the
// header counter); this module keeps the writes and the exhaustion check.
export { scanQuota, type ScanQuota };

/**
 * Scan metering. A subscriber spends the plan balance (users.plan_scans:
 * every paid invoice adds the plan's scans, unused scans stack, nothing resets
 * on the 1st), then invite-a-friend bonus scans, then Scan Pack scans
 * (users.extra_scans, one-time buys that never expire). An account with no
 * subscription and a pack balance is the "pack" tier: the balance is its whole
 * allowance. Comped accounts (no payments) keep the calendar-month counter.
 * Numbers: lib/pricing.ts.
 *
 * Spending is RESERVED before the paid work and given back if the work fails
 * (Chris, 09-30). Each bucket is drawn with a guarded UPDATE (`... WHERE
 * balance >= n`), so two scans in flight can never both spend the last scan
 * and none is ever lost to a stale read: the old count-after read-modify-write
 * let 20 real binder scans count as 12 (subscriber 6cd43f, 09-28).
 */

/** @deprecated read PLAN_SCANS.standard (lib/pricing.ts is the source). */
export const MONTHLY_SCANS = PLAN_SCANS.standard;

const month = () => new Date().toISOString().slice(0, 7);
// Legacy accounts are metered per DAY; the day key shares the scan_month
// column (it's just the counter's period label).
const day = () => new Date().toISOString().slice(0, 10);

/** True when the seller has nothing left to spend. */
export function scanQuotaExhausted(user: User): boolean {
  const q = scanQuota(user);
  return q.remaining !== null && q.remaining <= 0;
}

/**
 * The 402 message when nothing is left to spend. A subscriber is told when the
 * next payment credits more (Eastern date), or that a Scan Pack works now; an
 * account with paused plan scans is told they come back on resubscribe.
 */
export function outOfScansMessage(user: User, q: ScanQuota = scanQuota(user)): string {
  if (spendsPlanScans(user)) {
    const next = q.nextCreditAt ? etDate(q.nextCreditAt, "", { month: "short", day: "numeric" }) : "";
    return next
      ? `You're out of scans. Your next ${PLAN_SCANS[planOf(user)].toLocaleString("en-US")} arrive on ${next}, or add a Scan Pack (${PRICE.pack}) to keep scanning now`
      : `You're out of scans. Add a Scan Pack (${PRICE.pack}) to keep scanning`;
  }
  return q.frozen
    ? `You're out of scans. Your ${q.frozen.toLocaleString("en-US")} banked plan scans come back when you resubscribe, or buy a Scan Pack to keep scanning`
    : "You're out of scans. Subscribe or buy a Scan Pack to keep scanning";
}

type Bucket = "plan" | "bonus" | "pack" | "counter" | "trial";

/** What a reservation took from each bucket, so a failed read can put it back. */
export interface ScanDraw {
  plan: number;
  bonus: number;
  pack: number;
  /** The calendar/day counter (comped, legacy, owner): scans added to scans_used. */
  counter: number;
  /** The counter's period key (yyyy-mm or yyyy-mm-dd) at draw time. */
  counterKey: string | null;
  /** The free trial's lifetime count. */
  trial: number;
}

export interface ScanReservation {
  /** Scans actually taken: the whole ask, or fewer when the balance ran short (0 = nothing left). */
  taken: number;
  draw: ScanDraw;
  /** The balance after the reservation, ready to ship in the response. */
  usage: ScanQuota;
}

const emptyDraw = (): ScanDraw => ({ plan: 0, bonus: 0, pack: 0, counter: 0, counterKey: null, trial: 0 });

interface BalanceRow {
  plan_scans: number | null;
  bonus_scans: number | null;
  extra_scans: number | null;
  scan_month: string | null;
  scans_used: number | null;
  trial_scans_used: number | null;
}

/** The buckets this account spends, in draw order, with each one's cap on the counter kinds. */
function bucketsFor(user: User): { order: Bucket[]; counterKey: string | null; counterCap: number | null } {
  const tier = scanTier(user);
  if (tier === "trial") return { order: ["trial"], counterKey: null, counterCap: null };
  if (tier === "legacy") return { order: ["counter"], counterKey: day(), counterCap: LEGACY_DAILY_SCANS };
  if (tier === "owner") return { order: ["counter"], counterKey: month(), counterCap: null };
  if (tier === "pack") return { order: ["pack"], counterKey: null, counterCap: null };
  if (isComped(user)) return { order: ["counter", "bonus", "pack"], counterKey: month(), counterCap: monthlyScans(user) };
  return { order: ["plan", "bonus", "pack"], counterKey: null, counterCap: null };
}

/** Guarded take of `k` scans from one bucket: true when the row changed. */
async function take(bucket: Bucket, userId: string, k: number, counterKey: string | null, counterCap: number | null): Promise<boolean> {
  let res;
  if (bucket === "plan") {
    res = await db.prepare("UPDATE users SET plan_scans = plan_scans - ? WHERE id = ? AND plan_scans >= ?").run(k, userId, k);
  } else if (bucket === "bonus") {
    res = await db.prepare("UPDATE users SET bonus_scans = bonus_scans - ? WHERE id = ? AND bonus_scans >= ?").run(k, userId, k);
  } else if (bucket === "pack") {
    res = await db.prepare("UPDATE users SET extra_scans = extra_scans - ? WHERE id = ? AND extra_scans >= ?").run(k, userId, k);
  } else if (bucket === "trial") {
    res = await db
      .prepare("UPDATE users SET trial_scans_used = trial_scans_used + ? WHERE id = ? AND trial_scans_used + ? <= ?")
      .run(k, userId, k, TRIAL_SCANS);
  } else if (counterCap === null) {
    // Owner: metered, never enforced.
    res = await db
      .prepare("UPDATE users SET scans_used = (CASE WHEN scan_month = ? THEN scans_used ELSE 0 END) + ?, scan_month = ? WHERE id = ?")
      .run(counterKey, k, counterKey, userId);
  } else {
    res = await db
      .prepare(
        `UPDATE users SET scans_used = (CASE WHEN scan_month = ? THEN scans_used ELSE 0 END) + ?, scan_month = ?
         WHERE id = ? AND (CASE WHEN scan_month = ? THEN scans_used ELSE 0 END) + ? <= ?`,
      )
      .run(counterKey, k, counterKey, userId, counterKey, k, counterCap);
  }
  return res.changes > 0;
}

/** How many scans one bucket could give right now, from a fresh row (a hint: the guarded UPDATE has the last word). */
function headroom(bucket: Bucket, row: BalanceRow, counterKey: string | null, counterCap: number | null): number {
  if (bucket === "plan") return Math.max(0, row.plan_scans ?? 0);
  if (bucket === "bonus") return Math.max(0, row.bonus_scans ?? 0);
  if (bucket === "pack") return Math.max(0, row.extra_scans ?? 0);
  if (bucket === "trial") return Math.max(0, TRIAL_SCANS - (row.trial_scans_used ?? 0));
  if (counterCap === null) return Number.MAX_SAFE_INTEGER;
  const used = row.scan_month === counterKey ? row.scans_used ?? 0 : 0;
  return Math.max(0, counterCap - used);
}

function record(draw: ScanDraw, bucket: Bucket, k: number, counterKey: string | null): void {
  if (bucket === "counter") {
    draw.counter += k;
    draw.counterKey = counterKey;
  } else {
    draw[bucket] += k;
  }
}

/**
 * Take `n` scans BEFORE the paid work, in draw order (plan balance, then
 * bonus, then Scan Pack; comped: the month counter first). One scan is a blind
 * guarded UPDATE per bucket; several (a CSV import) read the balances once as a
 * hint and take what each bucket can give, re-reading if another request got
 * there first. Every take is a single guarded statement, so a balance can never
 * go below zero and two reservations never spend the same scan.
 * `taken` < n means the balance ran short (0 = nothing at all).
 */
export async function reserveScans(user: User, n: number): Promise<ScanReservation> {
  const draw = emptyDraw();
  if (n > 0) {
    // An unmigrated subscriber's balance is written from the old counter on
    // first use, before the first guarded take (which would read NULL as 0).
    if (spendsPlanScans(user) && user.planScans === null) await ensurePlanSeed(user.id);
    const { order, counterKey, counterCap } = bucketsFor(user);
    let left = n;
    if (n === 1) {
      for (const bucket of order) {
        if (await take(bucket, user.id, 1, counterKey, counterCap)) {
          record(draw, bucket, 1, counterKey);
          left = 0;
          break;
        }
      }
    } else {
      for (let attempt = 0; attempt < 6 && left > 0; attempt++) {
        const row = (await db
          .prepare("SELECT plan_scans, bonus_scans, extra_scans, scan_month, scans_used, trial_scans_used FROM users WHERE id = ?")
          .get(user.id)) as BalanceRow | undefined;
        if (!row) break;
        let hinted = false;
        for (const bucket of order) {
          if (left <= 0) break;
          const k = Math.min(left, headroom(bucket, row, counterKey, counterCap));
          if (k <= 0) continue;
          hinted = true;
          if (await take(bucket, user.id, k, counterKey, counterCap)) {
            record(draw, bucket, k, counterKey);
            left -= k;
          }
        }
        if (!hinted) break;
      }
    }
  }
  const fresh = (await findUserById(user.id)) ?? user;
  return { taken: draw.plan + draw.bonus + draw.pack + draw.counter + draw.trial, draw, usage: scanQuota(fresh) };
}

/** Reserve one scan (the single-card scan route). */
export function reserveScan(user: User): Promise<ScanReservation> {
  return reserveScans(user, 1);
}

/**
 * Put scans back because the work they paid for did not happen (the vision
 * read failed, an import wrote fewer cards than reserved). Returns them in the
 * reverse of the draw order (the last scan taken is the first given back);
 * `count` defaults to everything the reservation took. Never throws for a
 * missing row; answers the balance afterwards.
 */
export async function giveBackScans(user: User, reservation: ScanReservation, count = reservation.taken): Promise<ScanQuota> {
  let left = Math.max(0, Math.min(count, reservation.taken));
  const d = reservation.draw;
  const steps: [Bucket, number][] = [["pack", d.pack], ["bonus", d.bonus], ["plan", d.plan], ["counter", d.counter], ["trial", d.trial]];
  for (const [bucket, drawn] of steps) {
    const k = Math.min(left, drawn);
    if (k <= 0) continue;
    if (bucket === "plan") {
      await db.prepare("UPDATE users SET plan_scans = COALESCE(plan_scans, 0) + ? WHERE id = ?").run(k, user.id);
    } else if (bucket === "bonus") {
      await db.prepare("UPDATE users SET bonus_scans = bonus_scans + ? WHERE id = ?").run(k, user.id);
    } else if (bucket === "pack") {
      await db.prepare("UPDATE users SET extra_scans = extra_scans + ? WHERE id = ?").run(k, user.id);
    } else if (bucket === "trial") {
      await db.prepare("UPDATE users SET trial_scans_used = MAX(0, trial_scans_used - ?) WHERE id = ?").run(k, user.id);
    } else {
      // Only while the counter still belongs to the period it was drawn in.
      await db.prepare("UPDATE users SET scans_used = MAX(0, scans_used - ?) WHERE id = ? AND scan_month = ?").run(k, user.id, d.counterKey);
    }
    left -= k;
  }
  const fresh = (await findUserById(user.id)) ?? user;
  return scanQuota(fresh);
}
