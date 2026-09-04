import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { deleteCardPhoto } from "@/lib/server/cardPhotos";
import { hashPassword } from "@/lib/server/password";

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
  subStatus: string | null;
  subPeriodEnd: number | null;
  /** 'standard' | 'pro' — from the Stripe price on the subscription. */
  plan: Plan | null;
  /** Scan metering: counter month (yyyy-mm), scans used in it, purchased bank. */
  scanMonth: string | null;
  scansUsed: number;
  extraScans: number;
  /** Free trial: scans taken without a subscription, lifetime. */
  trialScansUsed: number;
  /** Auto-offers to watchers: percent set = daily job may send on slow movers; NULL = off. */
  autoOfferPercent: number | null;
  autoOfferMessage: string | null;
  /** First-login tutorial finished/skipped; NULL = still owed. */
  tourSeenAt: number | null;
}

interface UserRow {
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
  sub_status: string | null;
  sub_period_end: number | null;
  plan: string | null;
  scan_month: string | null;
  scans_used: number | null;
  extra_scans: number | null;
  trial_scans_used: number | null;
  auto_offer_percent: number | null;
  auto_offer_message: string | null;
  tour_seen_at: number | null;
}

function fromRow(row: UserRow): User {
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
    subStatus: row.sub_status ?? null,
    subPeriodEnd: row.sub_period_end ?? null,
    plan: row.plan === "pro" ? "pro" : row.plan === "standard" ? "standard" : null,
    scanMonth: row.scan_month ?? null,
    scansUsed: row.scans_used ?? 0,
    extraScans: row.extra_scans ?? 0,
    trialScansUsed: row.trial_scans_used ?? 0,
    autoOfferPercent: row.auto_offer_percent ?? null,
    autoOfferMessage: row.auto_offer_message ?? null,
    tourSeenAt: row.tour_seen_at ?? null,
  };
}

/** An active (or grace-period) paid subscription. */
export function isSubscribed(user: Pick<User, "subStatus">): boolean {
  return user.subStatus === "active" || user.subStatus === "trialing" || user.subStatus === "past_due";
}

/** The two paid tiers (09-04). Scan caps per calendar month. */
export type Plan = "standard" | "pro";
export const PLAN_SCANS: Record<Plan, number> = { standard: 500, pro: 2000 };
export const PLAN_PRICE_USD: Record<Plan, string> = { standard: "$9.99", pro: "$24.99" };
export function planOf(user: Pick<User, "plan">): Plan {
  return user.plan === "pro" ? "pro" : "standard";
}
export function monthlyScans(user: Pick<User, "plan">): number {
  return PLAN_SCANS[planOf(user)];
}

/** Free trial (09-04): ten scans on a fresh account, no card. */
export const TRIAL_SCANS = 10;

export function trialScansLeft(user: Pick<User, "subStatus" | "trialScansUsed">): number {
  if (isSubscribed(user)) return 0;
  return Math.max(0, TRIAL_SCANS - (user.trialScansUsed ?? 0));
}

/** Subscribed, or still inside the free trial. Admins are handled by callers. */
/**
 * Access tiers (Chris, 09-04, the paid switch):
 *  - owner: Chris's own account, unlimited.
 *  - subscribed: 500 (Pro 2,000) a month.
 *  - legacy: accounts that existed before the switch get 100 scans a DAY,
 *    no subscription, no wall.
 *  - trial: new accounts, 10 scans lifetime, then the wall.
 */
export type ScanTier = "owner" | "subscribed" | "legacy" | "trial";
export const OWNER_EMAIL = "truefreemoney@gmail.com";
/** Accounts created before this instant are legacy (the paid switch, 09-04 ~13:25 UTC). */
export const PAID_SWITCH_AT = Date.UTC(2026, 8, 4, 13, 25, 0);
export const LEGACY_DAILY_SCANS = 100;

export function scanTier(user: Pick<User, "email" | "role" | "subStatus" | "createdAt">): ScanTier {
  if (user.email.toLowerCase() === OWNER_EMAIL || user.role === "admin") return "owner";
  if (isSubscribed(user)) return "subscribed";
  if (user.createdAt < PAID_SWITCH_AT) return "legacy";
  return "trial";
}

export function canUseApp(user: Pick<User, "email" | "role" | "subStatus" | "trialScansUsed" | "createdAt">): boolean {
  const tier = scanTier(user);
  return tier !== "trial" || trialScansLeft(user) > 0;
}

export async function setStripeCustomer(userId: string, customerId: string): Promise<void> {
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, userId);
}

export async function setSubscription(
  userId: string,
  status: string | null,
  periodEnd: number | null,
  plan?: Plan | null,
): Promise<void> {
  if (plan === undefined) {
    await db.prepare("UPDATE users SET sub_status = ?, sub_period_end = ? WHERE id = ?").run(status, periodEnd, userId);
  } else {
    await db
      .prepare("UPDATE users SET sub_status = ?, sub_period_end = ?, plan = ? WHERE id = ?")
      .run(status, periodEnd, plan, userId);
  }
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

export async function disableTotp(userId: string): Promise<void> {
  await db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = ?").run(userId);
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
): Promise<User> {
  const id = randomUUID();
  const createdAt = Date.now();
  const passwordHash = hashPassword(password);
  const normalizedEmail = email.trim().toLowerCase();

  await db
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, role, ebay_connected, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(id, name.trim(), normalizedEmail, passwordHash, role, createdAt);

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
    subStatus: null,
    subPeriodEnd: null,
    plan: null,
    scanMonth: null,
    scansUsed: 0,
    extraScans: 0,
    trialScansUsed: 0,
    autoOfferPercent: null,
    autoOfferMessage: null,
    tourSeenAt: null,
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

/**
 * The shared "Try it now" account. It's public and wiped on every entry, so
 * it must never hold anything personal — in particular it can't be linked to
 * a real eBay account (the tokens would be usable by the next visitor).
 */
export const DEMO_EMAIL = "demo@cardflip.dev";

export function isDemoUser(user: Pick<User, "email">): boolean {
  return user.email === DEMO_EMAIL;
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
  patch: { name?: string; email?: string },
): Promise<void> {
  if (patch.name !== undefined) {
    await db.prepare("UPDATE users SET name = ? WHERE id = ?").run(patch.name.trim(), userId);
  }
  if (patch.email !== undefined) {
    await db.prepare("UPDATE users SET email = ? WHERE id = ?").run(
      patch.email.trim().toLowerCase(),
      userId,
    );
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
 * Remove an account. Foreign keys cascade cards / sessions / wishlist /
 * price checks; card photos live on disk, so those go first.
 */
export async function deleteUser(userId: string): Promise<void> {
  const photoRows = (await db
    .prepare("SELECT id FROM cards WHERE user_id = ? AND photo_at IS NOT NULL")
    .all(userId)) as { id: string }[];
  for (const r of photoRows) {
    try { await deleteCardPhoto(r.id); } catch { /* best effort */ }
  }
  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
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
  /** Scans included per month on the current plan. */
  monthlyScans: number;
  /** owner | subscribed | legacy | trial — drives the wall and the plan copy. */
  tier: ScanTier;
  /** Whether the app is open to this account right now (server truth). */
  appAccess: boolean;
  /** First-login tutorial done; null = the scanner shows it next visit. */
  tourSeenAt: number | null;
}

/** Strips the password hash (and TOTP secret) before a user record ever reaches the client. */
export function toPublicUser(user: User): PublicUser {
  const { id, name, email, role, ebayConnected, createdAt, subStatus, subPeriodEnd } = user;
  return {
    id, name, email, role, ebayConnected, createdAt, totpEnabled: totpEnabled(user), subStatus, subPeriodEnd,
    trialScansLeft: trialScansLeft(user),
    plan: isSubscribed(user) ? planOf(user) : null,
    monthlyScans: monthlyScans(user),
    tier: scanTier(user),
    appAccess: canUseApp(user),
    tourSeenAt: user.tourSeenAt ?? null,
  };
}
