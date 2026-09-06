import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { findUserById, scanTier, type User } from "@/lib/server/users";

/**
 * Invite a friend (Chris, 09-06): subscribers only. A subscriber shares
 * their link; when a friend who signed up through it becomes a subscriber,
 * the referrer banks REFERRAL_BONUS_SCANS. The bonus is spent only after the
 * month's allowance (scanQuota.ts), so it never expires at the rollover.
 *
 * Rules: the friend must be a NEW account (referred_by is written at signup
 * only); the referrer must be a subscriber at the moment the friend's first
 * payment lands (a trial account earns nothing, whatever it shared); one
 * reward per referred account (referral_rewarded_at); the friend gets nothing
 * extra — the product is the pitch.
 */

export const REFERRAL_BONUS_SCANS = 500;

// Unambiguous letters/digits (no 0/O/1/I), 8 chars → 40 bits.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function mintCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

/** The account's share code, minted on first ask. */
export async function ensureReferralCode(user: Pick<User, "id" | "referralCode">): Promise<string> {
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintCode();
    if (await findUserByReferralCode(code)) continue;
    await db.prepare("UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL").run(code, user.id);
    const fresh = await findUserById(user.id);
    if (fresh?.referralCode) return fresh.referralCode;
  }
  throw new Error("Couldn't mint a referral code");
}

export async function findUserByReferralCode(code: string): Promise<User | null> {
  const norm = normalizeCode(code);
  if (!norm) return null;
  const row = (await db.prepare("SELECT id FROM users WHERE referral_code = ?").get(norm)) as { id: string } | undefined;
  return row ? findUserById(row.id) : null;
}

export function referralUrl(code: string, site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cardflip.io"): string {
  return `${site.replace(/\/$/, "")}/?ref=${encodeURIComponent(code)}`;
}

/**
 * Signup hook: remember who sent this account. Only ever sets an empty
 * referred_by, only for a real code, never to itself. Returns whether it stuck.
 */
export async function attachReferral(newUserId: string, code: string): Promise<boolean> {
  const referrer = await findUserByReferralCode(code);
  if (!referrer || referrer.id === newUserId) return false;
  await db
    .prepare("UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL")
    .run(referrer.id, newUserId);
  const fresh = await findUserById(newUserId);
  return fresh?.referredBy === referrer.id;
}

/**
 * Stripe-webhook hook, called on the not-subscribed → subscribed edge for the
 * referred account. Credits the referrer once, and only if the referrer is a
 * subscriber right now. Returns true when a bonus was banked.
 */
export async function rewardReferrerIfDue(referred: Pick<User, "id" | "referredBy" | "referralRewardedAt">, now = Date.now()): Promise<boolean> {
  if (!referred.referredBy || referred.referralRewardedAt) return false;
  const referrer = await findUserById(referred.referredBy);
  if (!referrer || scanTier(referrer) !== "subscribed") return false;
  // Stamp first, guarded, so a retried webhook can't pay twice.
  const stamped = await db
    .prepare("UPDATE users SET referral_rewarded_at = ? WHERE id = ? AND referral_rewarded_at IS NULL")
    .run(now, referred.id);
  if (!(stamped as { changes?: number }).changes) {
    const fresh = await findUserById(referred.id);
    if (fresh?.referralRewardedAt !== now) return false;
  }
  await db
    .prepare("UPDATE users SET bonus_scans = COALESCE(bonus_scans, 0) + ? WHERE id = ?")
    .run(REFERRAL_BONUS_SCANS, referrer.id);
  return true;
}

export interface ReferralStats {
  friendsJoined: number;
  friendsSubscribed: number;
  scansEarned: number;
}

export async function referralStats(userId: string): Promise<ReferralStats> {
  const row = (await db
    .prepare(
      "SELECT COUNT(*) AS joined, SUM(CASE WHEN referral_rewarded_at IS NOT NULL THEN 1 ELSE 0 END) AS subscribed FROM users WHERE referred_by = ?",
    )
    .get(userId)) as { joined: number; subscribed: number | null } | undefined;
  const friendsSubscribed = Number(row?.subscribed ?? 0);
  return { friendsJoined: Number(row?.joined ?? 0), friendsSubscribed, scansEarned: friendsSubscribed * REFERRAL_BONUS_SCANS };
}
