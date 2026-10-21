import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { ipGate } from "@/lib/server/rateLimitDb";
import { createPortalSession, stripeConfigured } from "@/lib/server/stripe";

/** POST — answers { url } to Stripe's hosted manage-billing portal. */
export async function POST(req: NextRequest) {
  const limited = await ipGate(req, "billing");
  if (limited) return limited;
  try {
    const user = await requireUser();
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
