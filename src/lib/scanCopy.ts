import type { ScanQuota } from "@/lib/quotaTypes";
import { etDate } from "@/lib/time";

/**
 * The words the site uses for a scan balance (Chris, 09-30: scans roll over).
 * Pure functions of the ScanQuota snapshot the server sends, so the header
 * counter, the account page, the welcome page and the tests all say the same
 * thing. Every date is the Eastern day (lib/time.ts). No secrets, no db: safe
 * on both sides.
 *
 * A rollover subscriber's snapshot has `plan` set (plan scans left); a comped
 * account keeps the calendar counter and has none. `frozen` is the banked plan
 * scans of an account that is not subscribed (they pause, and come back on
 * resubscribe); the counts below name only what is really paused or arriving.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

/** "Oct 25", the Eastern day a payment is due or a plan ends ("" when unknown). */
export function shortDate(ms: number | null | undefined): string {
  return etDate(ms, "", { month: "short", day: "numeric" });
}

/** True for the snapshot of a subscriber whose scans are the plan balance. */
export function hasPlanBalance(q: ScanQuota | null | undefined): q is ScanQuota & { plan: number } {
  return typeof q?.plan === "number";
}

/** Can the seller scan right now? Unlimited (null) counts; no snapshot yet does not. */
export function hasScansToUse(q: ScanQuota | null | undefined): boolean {
  return q != null && (q.remaining === null || q.remaining > 0);
}

/**
 * Has the payment the seller just made been credited? A rollover subscriber's
 * answer is a plan credit written since `sinceMs` (a Booster, bonus scans or a
 * paused plan balance that unfreezes at once are spendable before the payment
 * lands, so "has scans" would confirm too early); anyone else falls back to
 * "has scans to use".
 */
export function paymentCredited(q: ScanQuota | null | undefined, sinceMs: number): boolean {
  if (!q) return false;
  if (hasPlanBalance(q)) return typeof q.lastCreditAt === "number" && q.lastCreditAt >= sinceMs && q.plan > 0;
  return hasScansToUse(q);
}

/**
 * "Your next scans arrive on Oct 25", or null when no payment is coming (plan
 * ending, payment failed). No count: a downgrade scheduled for the end of the
 * period changes what the next payment buys, and nothing here reads the
 * pending change, so the sentence promises the date and not the amount.
 */
export function nextCreditSentence(q: ScanQuota): string | null {
  const when = shortDate(q.nextCreditAt);
  return when ? `Your next scans arrive on ${when}` : null;
}

/** "Plan ends Oct 25; 238 banked scans pause until you resubscribe", or null when the plan is not ending. */
export function planEndsSentence(q: ScanQuota): string | null {
  const when = shortDate(q.endsAt);
  if (!when) return null;
  const banked = q.plan ?? 0;
  return banked > 0 ? `Plan ends ${when}; ${fmt(banked)} banked ${banked === 1 ? "scan pauses" : "scans pause"} until you resubscribe` : `Plan ends ${when}`;
}

/** "238 banked plan scans are paused and come back when you resubscribe", or null when nothing is paused. */
export function frozenSentence(q: ScanQuota): string | null {
  const n = q.frozen ?? 0;
  return n > 0 ? `${fmt(n)} banked plan ${n === 1 ? "scan is paused and comes" : "scans are paused and come"} back when you resubscribe` : null;
}

/**
 * How the seller gets more scans, in one sentence for a "you are out" line:
 * a subscriber is told the next credit date (or that a Booster works now), an
 * account with paused plan scans that they come back on resubscribe.
 */
export function moreScansSentence(q: ScanQuota | null | undefined, tier: string | undefined): string {
  if (tier === "subscribed") {
    const next = q ? nextCreditSentence(q) : null;
    return next ? `${next}, or add a Booster to keep scanning now.` : "Add a Booster to keep scanning.";
  }
  const frozen = q ? frozenSentence(q) : null;
  return frozen ? `${frozen[0].toUpperCase()}${frozen.slice(1)}. A Booster works right away.` : "Subscribe or add a Booster to keep scanning.";
}

/** The header counter's tooltip. `tier` is the session's tier: only subscribers drop the "of N" and get the credit dates. */
export function scanCounterTitle(q: ScanQuota, tier: string | undefined): string {
  const remaining = q.remaining ?? 0;
  const frozen = frozenSentence(q);
  if (tier === "subscribed") {
    if (remaining <= 0) {
      return `No scans left. ${nextCreditSentence(q) ? `${nextCreditSentence(q)}, or tap to add a Booster` : "Tap to add a Booster"}`;
    }
    const parts = [`${fmt(remaining)} ${remaining === 1 ? "scan" : "scans"} left`];
    if (q.carried) parts.push(`${fmt(q.carried)} carried over`);
    if (q.bonus) parts.push(`${fmt(q.bonus)} bonus`);
    if (q.pack) parts.push(`${fmt(q.pack)} in your Booster`);
    const next = nextCreditSentence(q);
    const ends = planEndsSentence(q);
    return `${parts.join(", ")}${next ? `. ${next}` : ends ? `. ${ends}` : ""} — tap for more scans`;
  }
  const period = tier === "trial" ? "free scans" : tier === "legacy" ? "today" : "in your pack";
  if (remaining <= 0) {
    return `No scans left ${period === "free scans" ? "on the free trial" : period}${frozen ? `. ${frozen}` : ""} — get more`;
  }
  return `${fmt(remaining)} of ${fmt(q.included)} ${period} left${q.bonus ? ` (includes ${fmt(q.bonus)} bonus)` : ""}${frozen ? `. ${frozen}` : ""} — tap for more scans`;
}
