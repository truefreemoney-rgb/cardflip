import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { createPortalSession, stripeConfigured } from "@/lib/server/stripe";

/** POST — answers { url } to Stripe's hosted manage-billing portal. */
export async function POST(req: NextRequest) {
  const limited = limitOrRespond(`billing:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (!stripeConfigured() || !user.stripeCustomerId) {
      return NextResponse.json({ error: "No billing to manage yet" }, { status: 400 });
    }
    return NextResponse.json({ url: await createPortalSession(user.stripeCustomerId) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("billing/portal:", err);
    return NextResponse.json({ error: "Couldn't open billing — try again" }, { status: 502 });
  }
}
