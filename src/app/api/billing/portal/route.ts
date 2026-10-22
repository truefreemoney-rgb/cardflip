import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { limitOrRespondAsync, shutOutResponse, torResponse } from "@/lib/server/rateLimitDb";
import { LIMITS } from "@/lib/server/rateLimit";
import { createPortalSession, stripeConfigured } from "@/lib/server/stripe";

/** POST — answers { url } to Stripe's hosted manage-billing portal. */
export async function POST(req: NextRequest) {
  // Shut-out and Tor stay per IP; the budget itself is per signed-in user (10-22: it shared the sign-in budget per IP).
  const blocked = (await shutOutResponse(req)) ?? (await torResponse(req));
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const limited = await limitOrRespondAsync(`billing:${user.id}`, LIMITS.authAttempt);
    if (limited) return limited;
    if (!stripeConfigured() || !user.stripeCustomerId) {
      return NextResponse.json({ error: "No billing to manage yet" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const cancel = body?.flow === "cancel";
    return NextResponse.json({
      url: await createPortalSession(user.stripeCustomerId, {
        cancelSubscriptionId: cancel ? user.stripeSubscriptionId : null,
      }),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("billing/portal:", err);
    return NextResponse.json({ error: "Couldn't open billing — try again" }, { status: 502 });
  }
}
