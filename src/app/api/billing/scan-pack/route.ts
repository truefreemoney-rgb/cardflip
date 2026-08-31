import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { isDemoUser, isSubscribed } from "@/lib/server/users";
import { createPackCheckoutSession, stripeConfigured } from "@/lib/server/stripe";

/** POST — buy 150 extra scans: answers { url } to a one-time Stripe Checkout. */
export async function POST(req: NextRequest) {
  const limited = limitOrRespond(`billing:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't buy scans" }, { status: 403 });
    }
    // Packs top up a subscription's allowance — without one there is no cap to top up.
    if (!stripeConfigured() || !isSubscribed(user) || !user.stripeCustomerId) {
      return NextResponse.json({ error: "Scan packs need an active subscription" }, { status: 400 });
    }
    return NextResponse.json({ url: await createPackCheckoutSession(user.stripeCustomerId, user.id) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("billing/scan-pack:", err);
    return NextResponse.json({ error: "Couldn't start checkout — try again" }, { status: 502 });
  }
}
