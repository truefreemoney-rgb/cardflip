import { NextRequest, NextResponse } from "next/server";
import { fetchSubscription, verifyWebhook } from "@/lib/server/stripe";
import {
  findUserById,
  findUserByStripeCustomer,
  setStripeCustomer,
  setSubscription,
} from "@/lib/server/users";

/**
 * Stripe webhook — the one writer of users.sub_status/sub_period_end.
 * Registered events: checkout.session.completed (first payment),
 * customer.subscription.updated (renewal, payment failure, cancel-at-end),
 * customer.subscription.deleted (fully ended). Everything else is 200-and-
 * ignored so Stripe doesn't retry. Signature checked before touching JSON.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (!verifyWebhook(body, req.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  try {
    const obj = event.data.object;
    if (event.type === "checkout.session.completed") {
      const userId = typeof obj.client_reference_id === "string" ? obj.client_reference_id : null;
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;
      const user = userId ? await findUserById(userId) : customerId ? await findUserByStripeCustomer(customerId) : null;
      if (user && subscriptionId) {
        if (customerId && !user.stripeCustomerId) await setStripeCustomer(user.id, customerId);
        const sub = await fetchSubscription(subscriptionId);
        await setSubscription(user.id, sub.status, sub.periodEnd);
        console.info(`stripe: ${user.email} subscribed (${sub.status})`);
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      const user = customerId ? await findUserByStripeCustomer(customerId) : null;
      if (user) {
        const deleted = event.type === "customer.subscription.deleted";
        const status = deleted ? "canceled" : typeof obj.status === "string" ? obj.status : null;
        const items = obj.items as { data?: { current_period_end?: number }[] } | undefined;
        const end = items?.data?.[0]?.current_period_end ?? (obj.current_period_end as number | undefined) ?? null;
        await setSubscription(user.id, status, end ? end * 1000 : null);
        console.info(`stripe: ${user.email} subscription ${status}`);
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry with backoff — right call for a transient DB error.
    console.error("stripe webhook:", err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
