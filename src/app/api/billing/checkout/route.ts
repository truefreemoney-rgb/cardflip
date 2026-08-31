import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { isDemoUser, isSubscribed, setStripeCustomer } from "@/lib/server/users";
import { createCheckoutSession, createCustomer, stripeConfigured } from "@/lib/server/stripe";

/** POST — start a $9.99/mo subscription: answers { url } to Stripe Checkout. */
export async function POST(req: NextRequest) {
  const limited = limitOrRespond(`billing:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't subscribe" }, { status: 403 });
    }
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Billing isn't available yet" }, { status: 503 });
    }
    if (isSubscribed(user)) {
      return NextResponse.json({ error: "You already have an active subscription" }, { status: 409 });
    }
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      customerId = await createCustomer(user.email, user.id);
      await setStripeCustomer(user.id, customerId);
    }
    return NextResponse.json({ url: await createCheckoutSession(customerId, user.id) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("billing/checkout:", err);
    return NextResponse.json({ error: "Couldn't start checkout — try again" }, { status: 502 });
  }
}
