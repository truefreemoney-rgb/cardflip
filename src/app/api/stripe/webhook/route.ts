import { NextRequest, NextResponse } from "next/server";
import { isMailConfigured, sendWelcomeEmail } from "@/lib/server/mail";
import { rewardReferrerIfDue } from "@/lib/server/referrals";
import { fetchSubscription, verifyWebhook, planForPrice } from "@/lib/server/stripe";
import {
  findUserById,
  findUserByStripeCustomer,
  isSubscribed,
  setStripeCustomer,
  setStripeSubscription,
  setSubscription,
} from "@/lib/server/users";

/**
 * Stripe webhook — the one writer of users.sub_status/sub_period_end.
 * Registered events: checkout.session.completed (first payment),
 * customer.subscription.updated (renewal, payment failure, cancel-at-end),
 * customer.subscription.deleted (fully ended). Everything else is 200-and-
 * ignored so Stripe doesn't retry. Signature checked before touching JSON.
 *
 * users.stripe_subscription_id pins WHICH subscription the status mirrors
 * (09-09). A re-subscribe creates a second subscription under the same
 * customer; before the pin, the old one's .deleted event matched by
 * customer id and cancelled a paying user. Rules: checkout and an
 * active/trialing created/updated adopt the event's subscription; any other
 * updated/deleted for a different subscription than the stored one is
 * 200-and-ignored. Events without an id (never from Stripe; test fixtures)
 * are applied as before.
 */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
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
        await setSubscription(user.id, sub.status, sub.periodEnd, sub.plan);
        await setStripeSubscription(user.id, subscriptionId);
        console.info(`stripe: ${user.email} subscribed (${sub.status}, ${sub.plan})`);
        // Welcome once, on the not-subscribed -> subscribed edge (`user` was
        // read before setSubscription, so a retried event sees "active" and
        // skips). Never let a mail hiccup 500 the webhook into a Stripe retry.
        if (!isSubscribed(user) && isSubscribed({ subStatus: sub.status })) {
          // Invite a friend: the person who sent them gets their bonus on the
          // same edge (once; the referred row is stamped). Never 500s the hook.
          try {
            const rewarded = await rewardReferrerIfDue(user);
            if (rewarded) console.info(`stripe: referral bonus credited for ${user.email}`);
          } catch (err) {
            console.error(`stripe: referral reward for ${user.email} failed:`, err);
          }
          if (isMailConfigured()) {
            try {
              await sendWelcomeEmail(user.email);
            } catch (err) {
              console.error(`stripe: welcome email to ${user.email} failed:`, err);
            }
          }
        }
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      const user = customerId ? await findUserByStripeCustomer(customerId) : null;
      if (user) {
        const deleted = event.type === "customer.subscription.deleted";
        const status = deleted ? "canceled" : typeof obj.status === "string" ? obj.status : null;
        const subscriptionId = typeof obj.id === "string" ? obj.id : null;
        const stored = user.stripeSubscriptionId;
        if (subscriptionId && stored && subscriptionId !== stored) {
          // A different subscription than the one we mirror. Only a live one
          // may take over (the re-subscribe case); a stale one ending must
          // not touch a paying account.
          if (deleted || !status || !ACTIVE_STATUSES.has(status)) {
            console.info(`stripe: ${user.email} ignored ${event.type} for ${subscriptionId} (mirroring ${stored})`);
            return NextResponse.json({ received: true, ignored: true });
          }
        }
        if (subscriptionId && !deleted && status && ACTIVE_STATUSES.has(status) && subscriptionId !== stored) {
          await setStripeSubscription(user.id, subscriptionId);
        }
        const items = obj.items as { data?: { current_period_end?: number; price?: { id?: string } }[] } | undefined;
        const item = items?.data?.[0];
        const end = item?.current_period_end ?? (obj.current_period_end as number | undefined) ?? null;
        // A plan switch in the billing portal arrives as .updated with the new
        // price. No price on the event = leave the plan column alone (mapping
        // "unknown" to standard would demote a Pro seller).
        const priceId = item?.price?.id;
        const plan = deleted || !priceId ? undefined : planForPrice(priceId);
        await setSubscription(user.id, status, end ? end * 1000 : null, plan);
        console.info(`stripe: ${user.email} subscription ${status}${plan ? ` (${plan})` : ""}`);
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry with backoff — right call for a transient DB error.
    console.error("stripe webhook:", err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
