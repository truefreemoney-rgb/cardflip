import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { redeemPromo } from "@/lib/server/promoCodes";
import { LIMITS } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";

/**
 * Redeem a promo code (lib/server/promoCodes.ts): the FLIPBACK mail's button
 * (/app?code=FLIPBACK) and the Account page's "Have a code?" box. Durable rate
 * limit per account, so nobody can guess codes in a loop.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const limited = await limitOrRespondAsync(`account:redeem:${user.id}`, LIMITS.authAccount);
    if (limited) return limited;
    const body = await req.json().catch(() => null);
    const result = await redeemPromo(user, body?.code);
    if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason, error: result.message }, { status: result.reason === "already" ? 200 : 400 });
    return NextResponse.json({ ok: true, scans: result.scans });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
