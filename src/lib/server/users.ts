import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { deleteCardPhoto } from "@/lib/server/cardPhotos";
import { hashPassword } from "@/lib/server/password";
import { PRICE, PRICING } from "@/lib/pricing";
import type { ScanQuota } from "@/lib/quotaTypes";
import { CREDITS_FROM, SEED_WINDOW_ENDS_AT, seedAmount } from "@/lib/planSeed";
import { emailConfirmActive } from "@/lib/server/mail";

export type { ScanQuota };

export type Role = "user" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  ebayConnected: boolean;
  createdAt: number;
  /** Set during two-step setup; only counts once totpEnabledAt is stamped. */
  totpSecret: string | null;
  totpEnabledAt: number | null;
  /** Stripe: set on first checkout; status mirrors the subscription via webhook. */
  stripeCustomerId: string | null;
  /** The Stripe subscription sub_status mirrors; webhook events for any other subscription are ignored. */
  stripeSubscriptionId: string | null;
  subStatus: string | null;
  subPeriodEnd: number | null;
  /** When a subscription set to cancel ends (ms epoch); null = not ending. Banked plan scans pause then. */
  subCancelAt: number | null;
  /** 'standard' | 'pro' — from the Stripe price on the subscription. */
  plan: Plan | null;
  /**
   * Scan metering: counter month (yyyy-mm), scans used in it, purchased bank.
   * scanMonth/scansUsed still meter legacy (day), owner and comped accounts;
   * a rollover subscriber spends planScans instead.
   */
  scanMonth: string | null;
  scansUsed: number;
  /** Rollover balance (payments credit it, scans spend it); null = not migrated yet (planSeedFor). */
  planScans: number | null;
  /** What the latest payment credited, and when (the "carried over" line). */
  planCreditScans: number;
  planCreditAt: number | null;
  extraScans: number;
  /** Free trial: scans taken without a subscription, lifetime. */
  trialScansUsed: number;
  /** Auto-offers to watchers: percent set = daily job may send on slow movers; NULL = off. */
  autoOfferPercent: number | null;
  autoOfferMessage: string | null;
  /** First-login tutorial finished/skipped; NULL = still owed. */
  tourSeenAt: number | null;
  /** Admin plan override; NULL = automatic (Stripe / legacy / trial). */
  accessOverride: AccessOverride | null;
  /** sha256 of each unused two-step backup code. */
  totpBackupCodes: string[];
  referralCode: string | null;
  referredBy: string | null;
  referralRewardedAt: number | null;
  bonusScans: number;
  /** Public collection page (Tier 2 #10): the /u/<handle> slug and whether the page is open. */
  handle: string | null;
  handlePublic: boolean;
  /** Last app open (/api/auth/me heartbeat, 10-minute grain); null = not since 09-30. */
  lastSeenAt: number | null;
  /** Public signup that still owes an email confirmation (lib/server/emailVerify.ts). */
  emailPending: boolean;
  /** When an inbox was proven (code, link, reset link or an admin); null = never. */
  emailVerifiedAt: number | null;
  /** ISO country the account was created in (x-vercel-ip-country); null = legacy/unknown = allowed. */
  homeCountry: string | null;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  ebay_connected: number;
  created_at: number;
  totp_secret: string | null;
  totp_enabled_at: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  sub_status: string | null;
  sub_period_end: number | null;
  sub_cancel_at: number | null;
  plan: string | null;
  scan_month: string | null;
  scans_used: number | null;
  plan_scans: number | null;
  plan_credit_scans: number | null;
  plan_credit_at: number | null;
  extra_scans: number | null;
  trial_scans_used: number | null;
  auto_offer_percent: number | null;
  auto_offer_message: string | null;
  tour_seen_at: number | null;
  access_override: string | null;
  totp_backup_codes: string | null;
  referral_code: string | null;
  referred_by: string | null;
  referral_rewarded_at: number | null;
  bonus_scans: number | null;
  handle: string | null;
  handle_public: number | null;
  last_seen_at: number | null;
  email_pending: number | null;
  email_verified_at: number | null;
  home_country: string | null;
}

function parseBackupCodes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Row → User. Exported for queries that join users (activeUsers.ts). */
export function fromRow(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    ebayConnected: row.ebay_connected === 1,
    createdAt: row.created_at,
    totpSecret: row.totp_secret ?? null,
    totpEnabledAt: row.totp_enabled_at ?? null,
    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    subStatus: row.sub_status ?? null,
    subPeriodEnd: row.sub_period_end ?? null,
    subCancelAt: row.sub_cancel_at ?? null,
    plan: row.plan === "pro" ? "pro" : row.plan === "standard" ? "standard" : null,
    scanMonth: row.scan_month ?? null,
    scansUsed: row.scans_used ?? 0,
    planScans: row.plan_scans ?? null,
    planCreditScans: row.plan_credit_scans ?? 0,
    planCreditAt: row.plan_credit_at ?? null,
    extraScans: row.extra_scans ?? 0,
    trialScansUsed: row.trial_scans_used ?? 0,
    autoOfferPercent: row.auto_offer_percent ?? null,
    autoOfferMessage: row.auto_offer_message ?? null,
    tourSeenAt: row.tour_seen_at ?? null,
    accessOverride: (ACCESS_OVERRIDES as readonly string[]).includes(row.access_override ?? "")
      ? (row.access_override as AccessOverride)
      : null,
    totpBackupCodes: parseBackupCodes(row.totp_backup_codes),
    referralCode: row.referral_code ?? null,
    referredBy: row.referred_by ?? null,
    referralRewardedAt: row.referral_rewarded_at ?? null,
    bonusScans: row.bonus_scans ?? 0,
    handle: row.handle ?? null,
    handlePublic: row.handle_public === 1,
    lastSeenAt: row.last_seen_at ?? null,
    emailPending: row.email_pending === 1,
    emailVerifiedAt: row.email_verified_at ?? null,
    homeCountry: row.home_country ?? null,
  };
}

/** The account behind a public collection handle (any visibility). */
export async function findUserByHandle(handle: string): Promise<User | null> {
  const row = (await db.prepare("SELECT * FROM users WHERE handle = ?").get(handle)) as UserRow | undefined;
  return row ? fromRow(row) : null;
}

/** An active (or grace-period) paid subscription. */
export function isSubscribed(user: Pick<User, "subStatus">): boolean {
  return user.subStatus === "active" || user.subStatus === "trialing" || user.subStatus === "past_due";
}

/**
 * Admin plan overrides (Chris, 09-04: "plans need to be editable"). Set from
 * the admin console; NULL means the automatic rules below apply.
 *  - unlimited: like the owner, no cap, no wall.
 *  - comp_standard / comp_pro: a subscription's allowance without Stripe.
 *  - legacy: 100 scans a day, no wall.
 *  - trial: back to the 5-scan trial (and the wall after it).
 */
export const ACCESS_OVERRIDES = ["unlimited", "comp_standard", "comp_pro", "legacy", "trial"] as const;
export type AccessOverride = (typeof ACCESS_OVERRIDES)[number];

/** Comped by an admin — a paid allowance with no Stripe subscription behind it. */
export function isComped(user: Pick<User, "accessOverride">): boolean {
  return user.accessOverride === "comp_standard" || user.accessOverride === "comp_pro";
}

/** The two paid tiers (09-04). Scans each payment credits, from lib/pricing.ts. */
export type Plan = "standard" | "pro";
export const PLAN_SCANS: Record<Plan, number> = { standard: PRICING.standard.scans, pro: PRICING.pro.scans };
export const PLAN_PRICE_USD: Record<Plan, string> = { standard: PRICE.standard, pro: PRICE.pro };
/** One-time Scan Pack (09-25): banked in users.extra_scans, never expires. */
export const PACK_SCANS = PRICING.pack.scans;
export function planOf(user: Pick<User, "plan" | "accessOverride">): Plan {
  if (user.accessOverride === "comp_pro") return "pro";
  if (user.accessOverride === "comp_standard") return "standard";
  return user.plan === "pro" ? "pro" : "standard";
}
export function monthlyScans(user: Pick<User, "plan" | "accessOverride">): number {
  return PLAN_SCANS[planOf(user)];
}

/** Free trial (09-04, cut to five 09-25): five scans on a fresh account, no card. */
export const TRIAL_SCANS = PRICING.trial.scans;

export function trialScansLeft(
  user: Pick<User, "email" | "role" | "subStatus" | "createdAt" | "accessOverride" | "trialScansUsed" | "extraScans">,
): number {
  // The TIER decides, not the raw Stripe status: an admin "trial" override on
  // a still-subscribed account must behave like a fresh trial (09-06: it
  // walled Chris's test account instantly with "subscription ended").
  if (scanTier(user) !== "trial") return 0;
  return Math.max(0, TRIAL_SCANS - (user.trialScansUsed ?? 0));
}

/** Subscribed, or still inside the free trial. Admins are handled by callers. */
/**
 * Access tiers (Chris, 09-04, the paid switch):
 *  - owner: Chris's own account, unlimited.
 *  - subscribed: the plan balance (users.plan_scans, credited by each paid invoice; a comped
 *    account keeps the calendar-month counter), then bonus, then pack scans.
 *  - legacy: accounts that existed before the switch get 100 scans a DAY,
 *    no subscription, no wall.
 *  - pack: no subscription but a Scan Pack balance (users.extra_scans > 0):
 *    every feature open, no wall, until the balance is gone (09-25).
 *  - trial: new accounts, PRICING.trial.scans lifetime, then the wall.
 */
export type ScanTier = "owner" | "subscribed" | "legacy" | "pack" | "trial";
export const OWNER_EMAIL = "truefreemoney@gmail.com";
/** Accounts created before this instant are legacy (the paid switch, 09-04 ~13:25 UTC). */
export const PAID_SWITCH_AT = Date.UTC(2026, 8, 4, 13, 25, 0);
export const LEGACY_DAILY_SCANS = 100;

const quotaMonth = () => new Date().toISOString().slice(0, 7);
const quotaDay = () => new Date().toISOString().slice(0, 10);

/**
 * A real subscriber (Stripe status live, no admin override): the one tier that
 * spends users.plan_scans. Comped accounts read as the "subscribed" tier too
 * (they have the plan's allowance with no Stripe behind it) but keep the
 * calendar-month counter, so the branch is on isComped, not on the tier.
 */
export function spendsPlanScans(user: Pick<User, "email" | "role" | "subStatus" | "createdAt" | "accessOverride" | "extraScans">): boolean {
  return scanTier(user) === "subscribed" && !isComped(user);
}

/**
 * What to seed users.plan_scans with, or null when nothing is owed: only a
 * real subscriber whose balance is still NULL, inside the deploy-day window
 * (lib/planSeed.ts has the rule and the why). Pure, so reads can show the
 * balance before the row is ever written.
 */
export function planSeedFor(
  user: Pick<User, "email" | "role" | "subStatus" | "createdAt" | "accessOverride" | "extraScans" | "planScans" | "plan" | "scanMonth" | "scansUsed">,
  now = Date.now(),
): number | null {
  if (user.planScans !== null || now >= SEED_WINDOW_ENDS_AT || !spendsPlanScans(user)) return null;
  // An account made on or after Oct 1 first paid under the new rules: nothing is owed from the old counter.
  if (user.createdAt >= CREDITS_FROM) return null;
  return seedAmount(monthlyScans(user), user.scanMonth, user.scansUsed);
}

/** Plan scans the seller has, counting an unmigrated subscriber's seed (their old allowance) so nothing reads as zero on deploy day. */
export function planScansLeft(user: Parameters<typeof planSeedFor>[0], now = Date.now()): number {
  return Math.max(0, user.planScans ?? planSeedFor(user, now) ?? 0);
}

export function scanQuota(user: User, now = Date.now()): ScanQuota {
  const tier = scanTier(user);
  // Banked plan scans that cannot be spent because the plan ended (or never
  // started): shown so a paused balance never reads as lost. A live subscriber
  // on an override is paying, not "paused": say nothing (billingCredits alerts the owner).
  const frozen = !spendsPlanScans(user) && !isSubscribed(user) && tier !== "owner" && (user.planScans ?? 0) > 0 ? { frozen: user.planScans ?? 0 } : {};
  if (tier === "trial") {
    const t = user.trialScansUsed ?? 0;
    return { used: t, included: TRIAL_SCANS, remaining: Math.max(0, TRIAL_SCANS - t), ...frozen };
  }
  if (tier === "legacy") {
    const used = user.scanMonth === quotaDay() ? user.scansUsed : 0;
    return { used, included: LEGACY_DAILY_SCANS, remaining: Math.max(0, LEGACY_DAILY_SCANS - used), ...frozen };
  }
  if (tier === "owner") {
    const used = user.scanMonth === quotaMonth() ? user.scansUsed : 0;
    return { used, included: 0, remaining: null };
  }
  if (tier === "pack") {
    // No subscription: the pack balance is the whole allowance. `used` is
    // what the trial burned before they bought, so the counter reads
    // "100 / 100" the moment a pack lands.
    const pack = user.extraScans ?? 0;
    return { used: 0, included: pack, remaining: pack, pack, ...frozen };
  }
  const cap = monthlyScans(user);
  const bonus = user.bonusScans ?? 0;
  const pack = user.extraScans ?? 0;
  if (isComped(user)) {
    // Comped (an admin override, no payments): the old calendar-month counter.
    const used = user.scanMonth === quotaMonth() ? user.scansUsed : 0;
    return { used, included: cap, remaining: Math.max(0, cap - used) + bonus + pack, bonus, pack, ...frozen };
  }
  // Rollover subscriber: payments credit plan_scans, scans spend it, nothing resets.
  const plan = planScansLeft(user, now);
  const live = user.subStatus === "active" || user.subStatus === "trialing";
  return {
    used: 0,
    included: cap,
    remaining: plan + bonus + pack,
    bonus,
    pack,
    plan,
    carried: Math.max(0, plan - (user.planCreditScans ?? 0)),
    ...(user.planCreditScans > 0 ? { lastCredit: user.planCreditScans, lastCreditAt: user.planCreditAt ?? null } : {}),
    nextCreditAt: live && !user.subCancelAt ? user.subPeriodEnd ?? null : null,
    endsAt: user.subCancelAt ?? null,
  };
}

/** Scan Pack scans banked on the account (one-time buys, never expire). */
export function packScans(user: Pick<User, "extraScans">): number {
  return Math.max(0, user.extraScans ?? 0);
}

export function scanTier(user: Pick<User, "email" | "role" | "subStatus" | "createdAt" | "accessOverride" | "extraScans">): ScanTier {
  switch (user.accessOverride) {
    case "unlimited":
      return "owner";
    case "comp_standard":
    case "comp_pro":
      return "subscribed";
    case "legacy":
      return "legacy";
    case "trial":
      return "trial";
  }
  if (user.email.toLowerCase() === OWNER_EMAIL || user.role === "admin") return "owner";
  if (isSubscribed(user)) return "subscribed";
  if (user.createdAt < PAID_SWITCH_AT) return "legacy";
  if ((user.extraScans ?? 0) > 0) return "pack";
  return "trial";
}

/**
 * Email confirmation wall (lib/server/emailVerify.ts). Only a trial account
 * that signed up while the admin switch was on can be walled: scanTier already
 * exempts the owner, admins, every override but "trial", subscribers, legacy
 * and Scan Pack holders, and email_pending is 0 on every account that existed
 * before this shipped. Fails open when mail vanishes from the server's
 * environment, so a broken deploy can never wall people behind a code that
 * cannot be sent.
 */
export function needsEmailConfirm(
  user: Pick<User, "email" | "role" | "subStatus" | "createdAt" | "accessOverride" | "extraScans" | "emailPending">,
): boolean {
  return Boolean(user.emailPending) && scanTier(user) === "trial" && emailConfirmActive();
}

export function canUseApp(user: Pick<User, "email" | "role" | "subStatus" | "trialScansUsed" | "createdAt" | "accessOverride" | "extraScans" | "emailPending">): boolean {
  if (needsEmailConfirm(user)) return false;
  const tier = scanTier(user);
  return tier !== "trial" || trialScansLeft(user) > 0;
}

export async function setAccessOverride(userId: string, override: AccessOverride | null): Promise<void> {
  await db.prepare("UPDATE users SET access_override = ? WHERE id = ?").run(override, userId);
}

/**
 * Credit a Scan Pack (09-25). Keyed by the Stripe Checkout session so a
 * retried webhook credits once; answers false when that session was
 * already applied.
 */
export async function creditScanPack(userId: string, sessionId: string, scans: number, paymentIntent: string | null = null): Promise<boolean> {
  // One transaction (10-01 sweep): the key row and the balance land together. Apart, a failed UPDATE after the INSERT
  // made Stripe's retry see the key, answer "already applied", and the buyer never got the scans.
  return db.transaction(async (tx) => {
    const ins = await tx
      .prepare("INSERT OR IGNORE INTO scan_pack_purchases (session_id, user_id, scans, created_at, payment_intent) VALUES (?, ?, ?, ?, ?)")
      .run(sessionId, userId, scans, Date.now(), paymentIntent);
    if (!ins.changes) return false;
    await tx.prepare("UPDATE users SET extra_scans = extra_scans + ? WHERE id = ?").run(scans, userId);
    return true;
  });
}

/**
 * Take a refunded or disputed Scan Pack's scans back (10-01 sweep: they were kept). `fraction` of the pack is the target
 * (a partial refund a share, a dispute all of it); what earlier reversals took is netted, so a refund then a dispute
 * never takes more than the pack. Only scans still unspent can go (extra_scans floors at 0); `short` says how many
 * were already used. null = no pack was bought with that payment intent.
 */
export async function reverseScanPack(paymentIntent: string, fraction: number): Promise<{ userId: string; took: number; short: number } | null> {
  return db.transaction(async (tx) => {
    const row = (await tx.prepare("SELECT session_id, user_id, scans, reversed FROM scan_pack_purchases WHERE payment_intent = ?").get(paymentIntent)) as
      | { session_id: string; user_id: string; scans: number; reversed: number }
      | undefined;
    if (!row) return null;
    const target = Math.round(row.scans * Math.min(1, Math.max(0, fraction)));
    const delta = target - Number(row.reversed ?? 0);
    if (delta <= 0) return { userId: row.user_id, took: 0, short: 0 };
    const bal = (await tx.prepare("SELECT extra_scans FROM users WHERE id = ?").get(row.user_id)) as { extra_scans: number } | undefined;
    const took = Math.min(delta, Math.max(0, Number(bal?.extra_scans ?? 0)));
    if (took > 0) await tx.prepare("UPDATE users SET extra_scans = extra_scans - ? WHERE id = ?").run(took, row.user_id);
    await tx.prepare("UPDATE scan_pack_purchases SET reversed = ? WHERE session_id = ?").run(target, row.session_id);
    return { userId: row.user_id, took, short: delta - took };
  });
}

export async function setStripeCustomer(userId: string, customerId: string): Promise<void> {
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, userId);
}

/**
 * Checkout's customer: the stored one, else a new one claimed only into an EMPTY slot, so two racing requests settle on
 * one id (10-01 sweep). `create` is stripe.createCustomer (idempotent per account); a loser of the race, or a create
 * that Stripe answered "key in use" for, reads the winner's id back.
 */
export async function ensureStripeCustomer(user: Pick<User, "id" | "email" | "stripeCustomerId">, create: (email: string, userId: string) => Promise<string>): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  let made: string | null = null;
  try {
    made = await create(user.email, user.id);
  } catch (err) {
    const stored = (await findUserById(user.id))?.stripeCustomerId;
    if (stored) return stored;
    throw err;
  }
  const r = await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL").run(made, user.id);
  if (r.changes) return made;
  return (await findUserById(user.id))?.stripeCustomerId ?? made;
}

/** Pin which Stripe subscription owns this account's status (see the webhook). */
export async function setStripeSubscription(userId: string, subscriptionId: string | null): Promise<void> {
  await db.prepare("UPDATE users SET stripe_subscription_id = ? WHERE id = ?").run(subscriptionId, userId);
}

/**
 * Mirror the subscription. `plan` undefined = leave the plan column alone;
 * `cancelAt` (when a subscription set to cancel ends, null = not ending)
 * undefined = leave it alone too, so an event that does not say (or a
 * checkout) never clears a pending cancel by accident.
 */
export async function setSubscription(
  userId: string,
  status: string | null,
  periodEnd: number | null,
  plan?: Plan | null,
  cancelAt?: number | null,
): Promise<void> {
  const sets = ["sub_status = ?", "sub_period_end = ?"];
  const args: (string | number | null)[] = [status, periodEnd];
  if (plan !== undefined) {
    sets.push("plan = ?");
    args.push(plan);
  }
  if (cancelAt !== undefined) {
    sets.push("sub_cancel_at = ?");
    args.push(cancelAt);
  }
  await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...args, userId);
}

export async function findUserByStripeCustomer(customerId: string): Promise<User | null> {
  const row = (await db
    .prepare("SELECT * FROM users WHERE stripe_customer_id = ?")
    .get(customerId)) as UserRow | undefined;
  return row ? fromRow(row) : null;
}

export function totpEnabled(user: Pick<User, "totpSecret" | "totpEnabledAt">): boolean {
  return Boolean(user.totpSecret && user.totpEnabledAt);
}

/** Two-step setup: store the fresh secret, not yet enabled. */
export async function setTotpSecret(userId: string, secret: string): Promise<void> {
  await db.prepare("UPDATE users SET totp_secret = ?, totp_enabled_at = NULL WHERE id = ?").run(secret, userId);
}

/** First code confirmed — two-step is on from the next sign-in. */
export async function enableTotp(userId: string): Promise<void> {
  await db.prepare("UPDATE users SET totp_enabled_at = ? WHERE id = ?").run(Date.now(), userId);
}

/** Tutorial finished or skipped — never auto-shown again (replay lives on the account page). */
export async function markTourSeen(userId: string): Promise<void> {
  await db.prepare("UPDATE users SET tour_seen_at = ? WHERE id = ?").run(Date.now(), userId);
}

/**
 * Opened-the-app heartbeat for the admin Active Users tab (Chris 09-30).
 * /api/auth/me runs on every app open; it writes last_seen_at at most once
 * per SEEN_EVERY_MS per account, so a seller who opens the app all day
 * costs a handful of row writes, not one per page.
 */
export const SEEN_EVERY_MS = 10 * 60_000;

/** True when the heartbeat is due (never stamped, or the last one is 10+ minutes old). */
export function seenDue(user: Pick<User, "lastSeenAt">, now = Date.now()): boolean {
  return user.lastSeenAt === null || now - user.lastSeenAt >= SEEN_EVERY_MS;
}

/**
 * Stamp last_seen_at. The throttle is re-checked in SQL, so two tabs (or two
 * instances) that both saw a stale value still write once. True when it wrote.
 */
export async function markSeen(userId: string, now = Date.now()): Promise<boolean> {
  const res = await db
    .prepare("UPDATE users SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)")
    .run(now, userId, now - SEEN_EVERY_MS);
  return res.changes > 0;
}

export async function disableTotp(userId: string): Promise<void> {
  await db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_backup_codes = NULL WHERE id = ?").run(userId);
}

/** Replace the unused backup-code hashes (fresh set, or one fewer after a use). */
export async function setTotpBackupCodes(userId: string, hashes: string[]): Promise<void> {
  await db.prepare("UPDATE users SET totp_backup_codes = ? WHERE id = ?").run(JSON.stringify(hashes), userId);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const row = (await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase())) as UserRow | undefined;
  return row ? fromRow(row) : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const row = (await db.prepare("SELECT * FROM users WHERE id = ?").get(id)) as
    | UserRow
    | undefined;
  return row ? fromRow(row) : null;
}

export async function createUser(
  name: string,
  email: string,
  password: string,
  role: Role = "user",
  /**
   * emailPending: only the public signup route passes true, and only while email confirmation is on.
   * homeCountry: the signup route's x-vercel-ip-country; null off Vercel / admin-made accounts.
   */
  opts: { emailPending?: boolean; homeCountry?: string | null } = {},
): Promise<User> {
  const id = randomUUID();
  const createdAt = Date.now();
  const passwordHash = hashPassword(password);
  const normalizedEmail = email.trim().toLowerCase();
  const emailPending = opts.emailPending === true;
  const homeCountry = opts.homeCountry ?? null;

  await db
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, role, ebay_connected, created_at, email_pending, home_country)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(id, name.trim(), normalizedEmail, passwordHash, role, createdAt, emailPending ? 1 : 0, homeCountry);

  return {
    id,
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role,
    ebayConnected: false,
    createdAt,
    totpSecret: null,
    totpEnabledAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subStatus: null,
    subPeriodEnd: null,
    subCancelAt: null,
    plan: null,
    scanMonth: null,
    scansUsed: 0,
    planScans: null,
    planCreditScans: 0,
    planCreditAt: null,
    extraScans: 0,
    trialScansUsed: 0,
    autoOfferPercent: null,
    autoOfferMessage: null,
    tourSeenAt: null,
    accessOverride: null,
    totpBackupCodes: [],
    referralCode: null,
    referredBy: null,
    referralRewardedAt: null,
    bonusScans: 0,
    handle: null,
    handlePublic: false,
    lastSeenAt: null,
    emailPending,
    emailVerifiedAt: null,
    homeCountry,
  };
}

/** Auto-offer opt-in: a percent turns it on, null turns it off. */
export async function setAutoOffer(
  userId: string,
  percent: number | null,
  message: string | null,
): Promise<void> {
  await db.prepare("UPDATE users SET auto_offer_percent = ?, auto_offer_message = ? WHERE id = ?").run(
    percent,
    message,
    userId,
  );
}

export async function setEbayConnected(userId: string, connected: boolean): Promise<void> {
  await db.prepare("UPDATE users SET ebay_connected = ? WHERE id = ?").run(
    connected ? 1 : 0,
    userId,
  );
}

export async function setUserRole(userId: string, role: Role): Promise<void> {
  await db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
}

/** Account page: rename / change sign-in email. Email is normalised like signup. */
export async function updateUserProfile(
  userId: string,
  patch: { name?: string; email?: string; handle?: string | null; handlePublic?: boolean },
): Promise<void> {
  if (patch.name !== undefined) {
    await db.prepare("UPDATE users SET name = ? WHERE id = ?").run(patch.name.trim(), userId);
  }
  if (patch.email !== undefined) {
    await db.prepare("UPDATE users SET email = ? WHERE id = ?").run(
      patch.email.trim().toLowerCase(),
      userId,
    );
    // A reset link mailed to the old address must not outlive the move.
    await db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").run(userId);
  }
  if (patch.handle !== undefined) {
    await db.prepare("UPDATE users SET handle = ? WHERE id = ?").run(patch.handle, userId);
  }
  if (patch.handlePublic !== undefined) {
    await db.prepare("UPDATE users SET handle_public = ? WHERE id = ?").run(patch.handlePublic ? 1 : 0, userId);
  }
}

export async function updateUserPassword(userId: string, password: string): Promise<void> {
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(password),
    userId,
  );
}

/** What the account page shows as "your data" — counts only; all of it cascade-deletes with the user. */
export async function userDataSummary(userId: string): Promise<{
  cards: number;
  listed: number;
  sold: number;
  wishlist: number;
  priceChecks: number;
  sessions: number;
}> {
  const n = async (sql: string, ...args: (string | number)[]) =>
    ((await db.prepare(sql).get(userId, ...args)) as { n: number }).n;
  return {
    cards: await n("SELECT COUNT(*) AS n FROM cards WHERE user_id = ?"),
    listed: await n("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND status = 'listed'"),
    sold: await n("SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND status = 'sold'"),
    wishlist: await n("SELECT COUNT(*) AS n FROM wishlist_items WHERE user_id = ?"),
    priceChecks: await n("SELECT COUNT(*) AS n FROM price_checks WHERE user_id = ?"),
    sessions: await n("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?", Date.now()),
  };
}

/**
 * Remove an account. Child rows are deleted explicitly, in one transaction,
 * rather than trusting ON DELETE CASCADE: PRAGMA foreign_keys is per
 * connection and not guaranteed over Turso's HTTP client (db.ts), and a
 * user row that vanishes while its sessions / tokens stay is exactly the
 * kind of orphan that keeps a deleted account signed in. Idempotent — every
 * statement is a no-op on a second run. Card photos live on disk/blob, so
 * those go first (best effort).
 */
/** `deleteBlobs` is the test seam for the ticket-photo cleanup (default: @vercel/blob's del, when a token is set). */
export async function deleteUser(userId: string, deleteBlobs?: (urls: string[]) => Promise<unknown>): Promise<void> {
  const photoRows = (await db
    .prepare("SELECT id FROM cards WHERE user_id = ? AND photo_at IS NOT NULL")
    .all(userId)) as { id: string }[];
  for (const r of photoRows) {
    try { await deleteCardPhoto(r.id); } catch { /* best effort */ }
  }
  // Ticket photos live on public Blob URLs (10-01 sweep: they outlived the account). Collected before the rows go.
  const ticketImages = await ticketImageUrls(userId);
  await db.transaction(async (tx) => {
    // Every table in db.ts with a user_id (plus card_photos, keyed by card).
    for (const sql of [
      "DELETE FROM card_photos WHERE card_id IN (SELECT id FROM cards WHERE user_id = ?)",
      "DELETE FROM cards WHERE user_id = ?",
      "DELETE FROM sessions WHERE user_id = ?",
      "DELETE FROM ebay_tokens WHERE user_id = ?",
      "DELETE FROM push_subscriptions WHERE user_id = ?",
      "DELETE FROM wishlist_items WHERE user_id = ?",
      "DELETE FROM price_checks WHERE user_id = ?",
      "DELETE FROM help_messages WHERE user_id = ?",
      "DELETE FROM support_ticket_notes WHERE user_id = ?",
      "DELETE FROM support_tickets WHERE user_id = ?",
      "DELETE FROM password_resets WHERE user_id = ?",
      "DELETE FROM email_verifications WHERE user_id = ?",
      "DELETE FROM categories WHERE user_id = ?",
      // A signup that never confirmed could not scan, so deleting it must not
      // burn the device's free trial (typo the address, delete, sign up again).
      // Confirmed accounts keep their row: delete-and-resign-up stays a repeat.
      "DELETE FROM signup_log WHERE user_id IN (SELECT id FROM users WHERE id = ? AND email_pending = 1)",
      // scan_usage is kept on purpose: it is the cost ledger behind scan
      // margin (db.ts) and deliberately has no FK to users. It holds token
      // counts and dollars against an id that no longer resolves, nothing
      // personal.
      // Referrals live on users.referred_by (no referrals table): unpin
      // anyone this account invited so the column never points at nothing.
      "UPDATE users SET referred_by = NULL WHERE referred_by = ?",
      "DELETE FROM users WHERE id = ?",
    ]) {
      await tx.prepare(sql).run(userId);
    }
  });
  if (ticketImages.length && (deleteBlobs || process.env.BLOB_READ_WRITE_TOKEN)) {
    try {
      await (deleteBlobs ?? (async (urls: string[]) => (await import("@vercel/blob")).del(urls)))(ticketImages);
    } catch (err) {
      console.error("deleteUser: ticket photo cleanup failed:", err instanceof Error ? err.message : err);
    }
  }
}

/** Every Blob photo on this seller's tickets and their notes (JSON arrays of URLs). */
async function ticketImageUrls(userId: string): Promise<string[]> {
  const urls = new Set<string>();
  for (const sql of ["SELECT images FROM support_tickets WHERE user_id = ?", "SELECT images FROM support_ticket_notes WHERE user_id = ?"]) {
    try {
      for (const r of (await db.prepare(sql).all(userId)) as { images: string }[]) {
        const list: unknown = JSON.parse(r.images || "[]");
        if (Array.isArray(list)) for (const u of list) if (typeof u === "string" && u.startsWith("https://")) urls.add(u);
      }
    } catch {
      // A table or column an old database lacks: nothing to clean there.
    }
  }
  return [...urls];
}

export async function listAllUsers(): Promise<User[]> {
  const rows = (await db
    .prepare("SELECT * FROM users ORDER BY created_at DESC")
    .all()) as unknown as UserRow[];
  return rows.map(fromRow);
}

export async function countUsers(): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) as n FROM users").get()) as {
    n: number;
  };
  return row.n;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  ebayConnected: boolean;
  createdAt: number;
  totpEnabled: boolean;
  subStatus: string | null;
  subPeriodEnd: number | null;
  /** Free-trial scans still available (0 once used up or when subscribed). */
  trialScansLeft: number;
  /** 'standard' | 'pro' when subscribed. */
  plan: Plan | null;
  /** Scans each payment credits on the current plan. */
  monthlyScans: number;
  /** owner | subscribed | legacy | trial — drives the wall and the plan copy. */
  tier: ScanTier;
  /** Whether the app is open to this account right now (server truth). */
  appAccess: boolean;
  /** First-login tutorial done; null = the scanner shows it next visit. */
  tourSeenAt: number | null;
  /** Unused two-step backup codes left (0 when two-step is off). */
  totpBackupCodesLeft: number;
  /** Invite-a-friend scans banked, spent after the plan balance. */
  bonusScans: number;
  /** Scan Pack scans banked (one-time buys, never expire), spent last. */
  packScans: number;
  /** The header counter (09-07) and account page: scans left plus, for subscribers, carried over, next credit and any pause. */
  scans: ScanQuota;
  /** The subscription is set to cancel at the end of the period (subEndsAt): banked plan scans pause then. */
  cancelAtPeriodEnd: boolean;
  /** When a canceling subscription ends (ms epoch); null = not ending. */
  subEndsAt: number | null;
  /** Public collection page: the chosen handle and whether /u/<handle> is open. */
  handle: string | null;
  handlePublic: boolean;
  /** Email confirmation wall: true = the app is closed until the emailed code (or link) is used. */
  mustConfirmEmail: boolean;
  /** Signup country (ISO); drives the home-currency price hint. null = legacy/unknown (USD). */
  homeCountry: string | null;
}

/** Strips the password hash (and TOTP secret) before a user record ever reaches the client. */
export function toPublicUser(user: User): PublicUser {
  const { id, name, email, role, ebayConnected, createdAt, subStatus, subPeriodEnd } = user;
  return {
    id, name, email, role, ebayConnected, createdAt, totpEnabled: totpEnabled(user), subStatus, subPeriodEnd,
    trialScansLeft: trialScansLeft(user),
    plan: isSubscribed(user) || isComped(user) ? planOf(user) : null,
    monthlyScans: monthlyScans(user),
    tier: scanTier(user),
    appAccess: canUseApp(user),
    tourSeenAt: user.tourSeenAt ?? null,
    totpBackupCodesLeft: totpEnabled(user) ? user.totpBackupCodes.length : 0,
    bonusScans: user.bonusScans ?? 0,
    packScans: packScans(user),
    scans: scanQuota(user),
    cancelAtPeriodEnd: isSubscribed(user) && Boolean(user.subCancelAt),
    subEndsAt: isSubscribed(user) ? user.subCancelAt ?? null : null,
    handle: user.handle ?? null,
    handlePublic: Boolean(user.handlePublic),
    mustConfirmEmail: needsEmailConfirm(user),
    homeCountry: user.homeCountry ?? null,
  };
}
