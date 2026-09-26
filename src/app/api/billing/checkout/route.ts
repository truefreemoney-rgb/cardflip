import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { isSubscribed, setStripeCustomer } from "@/lib/server/users";
import { createCheckoutSession, createCustomer, createPackCheckoutSession, packConfigured, proConfigured, stripeConfigured } from "@/lib/server/stripe";

/**
 * POST { plan: "standard" | "pro" | "pack" } — answers { url } to Stripe
 * Checkout. "pack" is the one-time Scan Pack (09-25): allowed for anyone,
 * subscribed or not (a subscriber's pack scans are spent after the month).
 */
export async function POST(req: NextRequest) {
  const limited = limitOrRespond(`billing:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Billing isn't available yet" }, { status: 503 });
    }
    const body = (await req.json().catch(() => null)) as { plan?: unknown } | null;
    if (body?.plan === "pack") {
      if (!packConfigured()) {
        return NextResponse.json({ error: "Scan Packs aren't available yet" }, { status: 503 });
      }
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        customerId = await createCustomer(user.email, user.id);
        await setStripeCustomer(user.id, customerId);
      }
      return NextResponse.json({ url: await createPackCheckoutSession(customerId, user.id) });
    }
    if (isSubscribed(user)) {
      return NextResponse.json({ error: "You already have an active subscription" }, { status: 409 });
    }
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      customerId = await createCustomer(user.email, user.id);
      await setStripeCustomer(user.id, customerId);
    }
    const plan = body?.plan === "pro" ? "pro" : "standard";
    if (plan === "pro" && !proConfigured()) {
      return NextResponse.json({ error: "The Pro plan isn't available yet" }, { status: 503 });
    }
    return NextResponse.json({ url: await createCheckoutSession(customerId, user.id, plan) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("billing/checkout:", err);
    return NextResponse.json({ error: "Couldn't start checkout — try again" }, { status: 502 });
  }
}
