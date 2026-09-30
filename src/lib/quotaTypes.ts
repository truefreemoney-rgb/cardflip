/**
 * The scan-balance snapshot the header counter, the account page and every
 * scan response carry. One type, imported by the server (users.ts builds it)
 * and the client (lib/client/auth.ts, the account page) so a new field can
 * never be dropped by an inline copy. No imports: safe on both sides.
 *
 * Trial = lifetime allowance; legacy = per UTC day; owner = metered, never
 * enforced (remaining null); comped = the old calendar-month counter;
 * SUBSCRIBERS = the rollover balance (plan + bonus + pack): plan scans arrive
 * when a payment clears and stack, nothing resets on the 1st.
 */
export interface ScanQuota {
  /** Scans counted in the current period (trial lifetime / legacy day / comped or owner month). 0 for a rollover subscriber: use `plan`. */
  used: number;
  /** The period's allowance (trial, legacy day, comped month) or, for a subscriber, what ONE payment credits. */
  included: number;
  /** Scans the seller can spend now; null = not enforced (owner). */
  remaining: number | null;
  /** Invite-a-friend scans still banked (subscribers only); counted in remaining. */
  bonus?: number;
  /** Scan Pack scans still banked (never expire); counted in remaining. */
  pack?: number;
  /** Subscribers: plan scans left (users.plan_scans); counted in remaining. */
  plan?: number;
  /** Subscribers: part of `plan` that is more than the latest payment credited, i.e. carried over from earlier months. */
  carried?: number;
  /** Subscribers: scans the latest payment credited, and when (ms epoch); absent before the first credited payment. */
  lastCredit?: number;
  lastCreditAt?: number | null;
  /** Subscribers: when the next payment is due, so the next credit (ms epoch); null when the plan is ending, the payment failed or unknown. */
  nextCreditAt?: number | null;
  /** Subscribers whose plan is set to cancel: the day it ends (ms epoch). Banked plan scans pause then. */
  endsAt?: number | null;
  /** Not subscribed but plan scans are banked: they pause and come back on resubscribe. Not counted in remaining. */
  frozen?: number;
}
