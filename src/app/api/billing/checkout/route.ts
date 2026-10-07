import { NextRequest, NextResponse } from "next/server";
import { AuthError, emailGate, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { ensureStripeCustomer, isSubscribed } from "@/lib/server/users";
import { checkoutCurrency } from "@/lib/pricing";
import { createCheckoutSession, createCustomer, createPackCheckoutSession, packConfigured, proConfigured, stripeConfigured } from "@/lib/server/stripe";

/**
 * POST { plan: "standard" | "pro" | "pack" } — answers { url } to Stripe
 * Checkout. "pack" is the one-time Booster (09-25): allowed for anyone,
 * subscribed or not (a subscriber's pack scans are spent after the month).
 */
export async function POST(req: NextRequest) {
  const limited = await limitOrRespondAsync(`billing:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    // Paying does not prove the inbox, and Stripe is given user.email.
    const unconfirmed = emailGate(user, "Confirm your email first, then you can subscribe.");
    if (unconfirmed) return unconfirmed;
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Billing isn't available yet" }, { status: 503 });
    }
    const body = (await req.json().catch(() => null)) as { plan?: unknown } | null;
    if (body?.plan === "pack") {
      if (!packConfigured()) {
        return NextResponse.json({ error: "Boosters aren't available yet" }, { status: 503 });
      }
      const customerId = await ensureStripeCustomer(user, createCustomer);
      return NextResponse.json({ url: await createPackCheckoutSession(customerId, user.id, checkoutCurrency(user.homeCountry)) });
    }
    if (isSubscribed(user)) {
      return NextResponse.json({ error: "You already have an active subscription" }, { status: 409 });
    }
    const customerId = await ensureStripeCustomer(user, createCustomer);
    const plan = body?.plan === "pro" ? "pro" : "standard";
    if (plan === "pro" && !proConfigured()) {
      return NextResponse.json({ error: "The Pro plan isn't available yet" }, { status: 503 });
    }
    return NextResponse.json({ url: await createCheckoutSession(customerId, user.id, plan, checkoutCurrency(user.homeCountry)) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("billing/checkout:", err);
    return NextResponse.json({ error: "Couldn't start checkout — try again" }, { status: 502 });
  }
}
