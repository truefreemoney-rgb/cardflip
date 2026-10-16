import "server-only";
import { db } from "@/lib/db";
import { scanTier, type User } from "@/lib/server/users";

/**
 * Promo codes (10-16, Chris: the FLIPBACK come-back mail, 10 free scans).
 *
 * A code credits an account once (promo_redemptions). A trial account gets the
 * scans as more FREE TRIAL scans (trial_scans_used goes down), never as a
 * Booster: Booster scans unlock eBay selling, and selling is paid (09-04).
 * Every other tier gets bonus scans (used after the plan, never expire).
 * Only accounts that existed before the mail went out can redeem, so a fresh
 * signup can't farm it.
 */
export interface PromoCode {
  scans: number;
  /** Redeemable until (ms). */
  expiresAt: number;
  /** Only accounts created before this (ms). */
  joinedBefore: number;
}

export const PROMO_CODES: Record<string, PromoCode> = {
  // Nov 16 11:59pm ET; accounts made before Oct 17 00:00 ET.
  FLIPBACK: { scans: 10, expiresAt: Date.UTC(2026, 10, 17, 4, 59), joinedBefore: Date.UTC(2026, 9, 17, 4) },
};

export function normalizeCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32) : "";
}

export type RedeemResult =
  | { ok: true; scans: number; bucket: "trial" | "bonus" }
  | { ok: false; reason: "unknown" | "expired" | "new_account" | "already"; message: string };

export function checkCode(code: string, user: Pick<User, "createdAt">, now = Date.now()): RedeemResult | PromoCode {
  const promo = PROMO_CODES[code];
  if (!promo) return { ok: false, reason: "unknown", message: "That code doesn't look right. Check the spelling and try again." };
  if (now > promo.expiresAt) return { ok: false, reason: "expired", message: "That code has expired." };
  if (user.createdAt >= promo.joinedBefore) return { ok: false, reason: "new_account", message: "That code is for accounts that were already with us." };
  return promo;
}

export async function redeemPromo(user: User, rawCode: unknown, now = Date.now()): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  const checked = checkCode(code, user, now);
  if ("ok" in checked) return checked;
  const bucket: "trial" | "bonus" = scanTier(user) === "trial" ? "trial" : "bonus";
  // One transaction: the redemption row and the scans land together, or neither does.
  const credited = await db.transaction(async (tx) => {
    const ins = await tx
      .prepare("INSERT OR IGNORE INTO promo_redemptions (code, user_id, scans, bucket, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(code, user.id, checked.scans, bucket, now);
    if (!ins.changes) return false;
    if (bucket === "trial") {
      await tx.prepare("UPDATE users SET trial_scans_used = COALESCE(trial_scans_used, 0) - ? WHERE id = ?").run(checked.scans, user.id);
    } else {
      await tx.prepare("UPDATE users SET bonus_scans = COALESCE(bonus_scans, 0) + ? WHERE id = ?").run(checked.scans, user.id);
    }
    return true;
  });
  if (!credited) return { ok: false, reason: "already", message: "You've already used that code. Your scans are on your account." };
  return { ok: true, scans: checked.scans, bucket };
}
