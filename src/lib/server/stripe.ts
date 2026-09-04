import "server-only";
import crypto from "node:crypto";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Stripe billing, no SDK — the three calls we make (create customer, create
 * a Checkout/portal session, fetch a subscription) are plain form-encoded
 * POSTs, same hand-rolled philosophy as backup.ts's SigV4. Keys come from
 * STRIPE_SECRET_KEY / STRIPE_PRICE_ID / STRIPE_WEBHOOK_SECRET (test-mode
 * sandbox for now; swap the three env vars for live keys at launch).
 */

const env = () => ({
  secretKey: process.env.STRIPE_SECRET_KEY,
  priceId: process.env.STRIPE_PRICE_ID,
  /** Pro ($24.99/mo, 2,000 scans). Unset = Pro isn't offered yet. */
  proPriceId: process.env.STRIPE_PRO_PRICE_ID,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
});

export type StripePlan = "standard" | "pro";

export function proConfigured(): boolean {
  return Boolean(env().proPriceId);
}

/** Which plan a Stripe price id belongs to. */
export function planForPrice(priceId: string | null | undefined): StripePlan {
  const { proPriceId } = env();
  return priceId && proPriceId && priceId === proPriceId ? "pro" : "standard";
}

export function stripeConfigured(): boolean {
  const e = env();
  return Boolean(e.secretKey && e.priceId);
}

async function stripeRequest<T = Record<string, unknown>>(
  path: string,
  form?: Record<string, string>,
): Promise<T> {
  const { secretKey } = env();
  if (!secretKey) throw new Error("stripe: STRIPE_SECRET_KEY not set");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${secretKey}`,
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe: ${path} failed: ${json.error?.message ?? res.status}`);
  return json;
}

export async function createCustomer(email: string, userId: string): Promise<string> {
  const c = await stripeRequest<{ id: string }>("customers", {
    email,
    "metadata[userId]": userId,
  });
  return c.id;
}

/** Hosted Checkout for a subscription; returns the redirect URL. */
export async function createCheckoutSession(customerId: string, userId: string, plan: StripePlan = "standard"): Promise<string> {
  const { priceId, proPriceId } = env();
  const price = plan === "pro" && proPriceId ? proPriceId : priceId!;
  const s = await stripeRequest<{ url: string }>("checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${SITE_URL}/app/account?billing=success`,
    cancel_url: `${SITE_URL}/app/account?billing=canceled`,
  });
  return s.url;
}

/** Stripe's hosted manage-billing page (cancel, change card, invoices). */
export async function createPortalSession(customerId: string): Promise<string> {
  const s = await stripeRequest<{ url: string }>("billing_portal/sessions", {
    customer: customerId,
    return_url: `${SITE_URL}/app/account`,
  });
  return s.url;
}

export interface SubscriptionState {
  status: string;
  /** ms epoch; Basil-era API keeps period end on the item, older on the sub. */
  periodEnd: number | null;
  /** From the first item's price id. */
  plan: StripePlan;
}

export async function fetchSubscription(subscriptionId: string): Promise<SubscriptionState> {
  const sub = await stripeRequest<{
    status: string;
    current_period_end?: number;
    items?: { data?: { current_period_end?: number; price?: { id?: string } }[] };
  }>(`subscriptions/${subscriptionId}`);
  const item = sub.items?.data?.[0];
  const end = item?.current_period_end ?? sub.current_period_end ?? null;
  return { status: sub.status, periodEnd: end ? end * 1000 : null, plan: planForPrice(item?.price?.id) };
}

/**
 * Verify a webhook payload against the `stripe-signature` header
 * (HMAC-SHA256 of "<t>.<body>" with the endpoint secret, 5-minute skew).
 */
export function verifyWebhook(body: string, signature: string | null): boolean {
  const { webhookSecret } = env();
  if (!webhookSecret || !signature) return false;
  const parts = new Map(
    signature.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)] as const;
    }),
  );
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
