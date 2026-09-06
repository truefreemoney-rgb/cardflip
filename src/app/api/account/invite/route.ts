import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { scanTier } from "@/lib/server/users";
import { REFERRAL_BONUS_SCANS, ensureReferralCode, referralStats, referralUrl } from "@/lib/server/referrals";

/** Invite a friend: the account's share link + what it has earned so far. */
export async function GET() {
  try {
    const user = await requireUser();
    const eligible = scanTier(user) === "subscribed";
    const code = await ensureReferralCode(user);
    const stats = await referralStats(user.id);
    return NextResponse.json({
      eligible,
      code,
      url: referralUrl(code),
      bonusPerFriend: REFERRAL_BONUS_SCANS,
      bonusScans: user.bonusScans ?? 0,
      ...stats,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
