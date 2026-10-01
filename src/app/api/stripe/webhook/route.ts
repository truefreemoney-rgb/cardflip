import { NextRequest, NextResponse } from "next/server";
import { markNoSeedOwed } from "@/lib/server/scanCredits";
import { creditCheckoutInvoice, creditPaidInvoice, handleChargeRefunded, handleDisputeCreated } from "@/lib/server/billingCredits";
import { isMailConfigured, sendWelcomeEmail } from "@/lib/server/mail";
import { rewardReferrerIfDue } from "@/lib/server/referrals";
import { fetchSubscription, verifyWebhook, planForPrice, cancelAtFrom } from "@/lib/server/stripe";
import { PRICING } from "@/lib/pricing";
import {
  creditScanPack,
  findUserById,
  findUserByStripeCustomer,
  isSubscribed,
  setStripeCustomer,
  setStripeSubscription,
  setSubscription,
} from "@/lib/server/users";

/**
 * Stripe webhook — the one writer of users.sub_status/sub_period_end and of
 * scan credits. Events to register on BOTH endpoints (test and live):
 *   checkout.session.completed   first payment; credits the first invoice early
 *   customer.subscription.created / .updated / .deleted   status, plan, period
 *                                end, cancel-at-period-end (renewal, failure, cancel)
 *   invoice.paid                 EVERY paid subscription invoice credits its plan's scans
 *   charge.refunded              takes the invoice's credit back, in proportion
 *   charge.dispute.created       takes the invoice's whole credit back
 * Everything else is 200-and-ignored so Stripe doesn't retry. Signature
 * checked before touching JSON.
 *
 * Scan rollover (Chris, 09-30): scans arrive when a payment clears and stack;
 * nothing resets on the 1st. Credits come ONLY from a paid invoice, keyed by
 * the invoice id (lib/server/billingCredits.ts), for ANY subscription of the
 * customer: the pin below mirrors status and never gates money. Checkout and
 * invoice.paid share the key, so whichever arrives first credits and the other
 * does nothing; a database error is a 500 (Stripe retries) and leaves no half
 * credit. A daily reconcile job catches an invoice.paid that never arrived.
 * Portal settings the credits rely on: upgrades always_invoice (the proration
 * invoice is paid at once), downgrades at period end.
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
      const meta = (obj.metadata ?? {}) as Record<string, unknown>;
      if (user && obj.mode === "payment" && meta.pack === "1") {
        // Scan Pack (09-25): a one-time payment, no subscription. Credit the
        // scans the session was sold with; the session id keys the credit.
        if (customerId && !user.stripeCustomerId) await setStripeCustomer(user.id, customerId);
        const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
        const scans = Number(meta.packScans) > 0 ? Number(meta.packScans) : PRICING.pack.scans;
        const sessionId = typeof obj.id === "string" ? obj.id : null;
        if (paid && sessionId) {
          const credited = await creditScanPack(user.id, sessionId, scans);
          console.info(`stripe: ${user.email} scan pack ${credited ? `+${scans}` : "already credited"} (${sessionId})`);
        } else {
          console.info(`stripe: ${user.email} scan pack session ${sessionId} not paid (${String(obj.payment_status)}), ignored`);
        }
      } else if (user && subscriptionId) {
        if (customerId && !user.stripeCustomerId) await setStripeCustomer(user.id, customerId);
        const sub = await fetchSubscription(subscriptionId);
        // A brand-new subscription owes nothing from the old monthly counter (see markNoSeedOwed).
        await markNoSeedOwed(user.id);
        // The first invoice's scans are credited BEFORE the status flips (same
        // key as invoice.paid, so whichever event lands first credits once). If
        // the credit throws, the user is still "not subscribed", so Stripe's
        // retry redoes everything, welcome email and referral reward included;
        // credited after the flip, a failure would leave an active subscriber
        // with no scans whose retry skips the welcome edge below.
        const invoiceId = typeof obj.invoice === "string" ? obj.invoice : null;
        const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
        if (invoiceId && paid) await creditCheckoutInvoice(user, invoiceId, sub);
        await setSubscription(user.id, sub.status, sub.periodEnd, sub.plan, sub.cancelAt);
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
              await sendWelcomeEmail(user.email, sub.plan);
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
        const subscriptionId = typeof obj.id === "string" ? obj.id : null;
        // Stripe does not order events, and a retried old .updated can land after .deleted (10-01 sweep: "active" over
        // "canceled" gave a canceled seller their banked scans back). A live event is checked against the subscription as
        // it is NOW; if Stripe can't say, the payload stands, except one that would revive a canceled account: that one
        // answers 500 and Stripe retries it.
        let now: Awaited<ReturnType<typeof fetchSubscription>> | null = null;
        if (!deleted && subscriptionId) {
          try {
            now = await fetchSubscription(subscriptionId);
          } catch (err) {
            const revives = user.subStatus === "canceled" && typeof obj.status === "string" && ACTIVE_STATUSES.has(obj.status);
            if (revives) throw err;
          }
        }
        const status = deleted ? "canceled" : now ? now.status : typeof obj.status === "string" ? obj.status : null;
        const stored = user.stripeSubscriptionId;
        if (subscriptionId && stored && subscriptionId !== stored) {
          // A different subscription than the one we mirror. Only a live one
          // may take over (the re-subscribe case); a stale one ending must
          // not touch a paying account. Both the event and Stripe's current state must call it live.
          const eventLive = typeof obj.status === "string" && ACTIVE_STATUSES.has(obj.status);
          if (deleted || !status || !ACTIVE_STATUSES.has(status) || !eventLive) {
            console.info(`stripe: ${user.email} ignored ${event.type} for ${subscriptionId} (mirroring ${stored})`);
            return NextResponse.json({ received: true, ignored: true });
          }
        }
        if (subscriptionId && !deleted && status && ACTIVE_STATUSES.has(status) && subscriptionId !== stored) {
          await setStripeSubscription(user.id, subscriptionId);
        }
        // A subscription that goes live on an account that was not subscribed is a new
        // subscriber, whichever event arrives first (Stripe does not order them): nothing
        // from the old monthly counter is owed, so its NULL balance must not seed.
        const goesLive = !deleted && status !== null && ACTIVE_STATUSES.has(status) && !isSubscribed(user);
        if (event.type === "customer.subscription.created" || goesLive) await markNoSeedOwed(user.id);
        const items = obj.items as { data?: { current_period_end?: number; price?: { id?: string } }[] } | undefined;
        const item = items?.data?.[0];
        const end = item?.current_period_end ?? (obj.current_period_end as number | undefined) ?? null;
        // A plan switch in the billing portal arrives as .updated with the new
        // price. No price on the event = leave the plan column alone (mapping
        // "unknown" to standard would demote a Pro seller).
        const priceId = now ? now.priceId : item?.price?.id;
        const plan = deleted || !priceId ? undefined : planForPrice(priceId);
        // Cancel-at-period-end: remember when the plan ends so the account page
        // can say banked scans pause then. Only an event that carries the
        // fields changes it (a fixture without them leaves it alone); the end
        // of the subscription clears it.
        const endMs = now ? now.periodEnd : end ? end * 1000 : null;
        const cancelAt = deleted
          ? null
          : now
            ? now.cancelAt
            : "cancel_at_period_end" in obj || "cancel_at" in obj
              ? cancelAtFrom(obj as { cancel_at_period_end?: unknown; cancel_at?: unknown }, endMs)
              : undefined;
        await setSubscription(user.id, status, endMs, plan, cancelAt);
        console.info(`stripe: ${user.email} subscription ${status}${plan ? ` (${plan})` : ""}${cancelAt ? " ending" : ""}`);
      }
    } else if (event.type === "invoice.paid") {
      // Every paid subscription invoice credits its plan's scans (once, by
      // invoice id), pinned subscription or not. A payload problem (unknown
      // price, no such customer) is reported on the Errors page and answers
      // 200; a database error throws into the 500 below so Stripe retries.
      const out = await creditPaidInvoice(obj, "webhook");
      if (out.result !== "credited") console.info(`stripe: invoice ${String(obj.id)} ${out.result}${out.note ? ` (${out.note})` : ""}`);
    } else if (event.type === "charge.refunded") {
      await handleChargeRefunded(obj);
    } else if (event.type === "charge.dispute.created") {
      await handleDisputeCreated(obj);
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry with backoff — right call for a transient DB error.
    console.error("stripe webhook:", err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
