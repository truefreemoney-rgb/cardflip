import "server-only";
import crypto from "node:crypto";
import { SITE_URL } from "@/lib/siteUrl";
import { PRICING, scansForPriceId } from "@/lib/pricing";

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
  /** Pro (lib/pricing.ts). Unset = Pro isn't offered yet. */
  proPriceId: process.env.STRIPE_PRO_PRICE_ID,
  /** One-time Scan Pack (lib/pricing.ts). Unset = packs aren't offered yet. */
  packPriceId: process.env.STRIPE_SCAN_PACK_PRICE_ID,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
});

export type StripePlan = "standard" | "pro";

export function proConfigured(): boolean {
  return Boolean(env().proPriceId);
}

export function packConfigured(): boolean {
  return Boolean(env().packPriceId);
}

/**
 * Which plan a Stripe price id belongs to, for mirroring users.plan. Known
 * ids (the environment, or pricing.ts with the retired ones) answer exactly;
 * an id nobody knows falls back to standard, fine for a label but NEVER for a
 * credit: scan credits use priceInfo, which says null instead of guessing.
 */
export function planForPrice(priceId: string | null | undefined): StripePlan {
  return priceInfo(priceId)?.plan ?? "standard";
}

/** Plan, scans and price (cents) a price id was sold for, or null when the id is unknown. */
export function priceInfo(priceId: string | null | undefined): { plan: StripePlan; scans: number; cents: number } | null {
  const { priceId: standard, proPriceId } = env();
  return scansForPriceId(priceId, { standard, pro: proPriceId });
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
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: form ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${secretKey}`,
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    // The timeout (TimeoutError/AbortError) and socket failures both land
    // here; callers already map a thrown Error to a clean 502 / retry.
    const why = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") ? "timed out" : "unreachable";
    throw new Error(`stripe: ${path} ${why}`);
  }
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

/**
 * Local-currency Checkout (Chris 09-30): `currency` picks one of the price's
 * currency_options (pricing.ts LOCAL_PRICING / checkoutCurrency). If Stripe
 * refuses it (a customer already billed in another currency is locked to it,
 * or the option is missing on the price), the session is made again in the
 * price's own USD rather than blocking the purchase.
 */
async function checkoutSession(params: Record<string, string>, currency: string | null | undefined): Promise<{ url: string }> {
  if (!currency) return stripeRequest<{ url: string }>("checkout/sessions", params);
  try {
    return await stripeRequest<{ url: string }>("checkout/sessions", { ...params, currency });
  } catch (err) {
    console.error(`stripe: checkout in ${currency} refused, falling back to USD:`, err);
    return stripeRequest<{ url: string }>("checkout/sessions", params);
  }
}

/** Hosted Checkout for a subscription; returns the redirect URL. */
export async function createCheckoutSession(
  customerId: string,
  userId: string,
  plan: StripePlan = "standard",
  currency: string | null = null,
): Promise<string> {
  const { priceId, proPriceId } = env();
  const price = plan === "pro" && proPriceId ? proPriceId : priceId!;
  const s = await checkoutSession({
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    // A fresh subscriber lands on one screen with one job (scan), not on
    // the Profile page (Chris, 09-25).
    success_url: `${SITE_URL}/app/account/welcome?billing=success`,
    cancel_url: `${SITE_URL}/app/account?billing=canceled`,
  }, currency);
  return s.url;
}

/**
 * Hosted Checkout for a one-time Scan Pack (09-25): mode=payment, no
 * subscription. The webhook credits users.extra_scans from
 * metadata.packScans (the credit follows what was sold, not what the code
 * says today), keyed by the session id so a retry never credits twice.
 */
export async function createPackCheckoutSession(customerId: string, userId: string, currency: string | null = null): Promise<string> {
  const { packPriceId } = env();
  if (!packPriceId) throw new Error("stripe: STRIPE_SCAN_PACK_PRICE_ID not set");
  const s = await checkoutSession({
    mode: "payment",
    customer: customerId,
    client_reference_id: userId,
    "line_items[0][price]": packPriceId,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    "metadata[pack]": "1",
    "metadata[packScans]": String(PRICING.pack.scans),
    success_url: `${SITE_URL}/app/account/welcome?billing=pack`,
    cancel_url: `${SITE_URL}/app/account?billing=canceled`,
  }, currency);
  return s.url;
}

/** Stripe's hosted manage-billing page (cancel, change card, invoices). */
export async function createPortalSession(
  customerId: string,
  opts: { cancelSubscriptionId?: string | null } = {},
): Promise<string> {
  const params: Record<string, string> = {
    customer: customerId,
    return_url: `${SITE_URL}/app/account`,
  };
  // The plain portal never leaves on its own; only a flow can redirect when
  // it finishes (Chris, 09-25: cancelling stranded him on Stripe's page).
  // Opened from the Cancel plan link, the portal goes straight to the cancel
  // confirmation and comes back to the account page when it is done.
  if (opts.cancelSubscriptionId) {
    params["flow_data[type]"] = "subscription_cancel";
    params["flow_data[subscription_cancel][subscription]"] = opts.cancelSubscriptionId;
    params["flow_data[after_completion][type]"] = "redirect";
    params["flow_data[after_completion][redirect][return_url]"] = `${SITE_URL}/app/account?billing=ending`;
  }
  const s = await stripeRequest<{ url: string }>("billing_portal/sessions", params);
  return s.url;
}

export interface SubscriptionState {
  status: string;
  /** ms epoch; Basil-era API keeps period end on the item, older on the sub. */
  periodEnd: number | null;
  /** From the first item's price id. */
  plan: StripePlan;
  /** The first item's price id (what a scan credit is worked out from). */
  priceId: string | null;
  /** When the subscription ends because it was set to cancel (ms epoch): the period end for cancel-at-period-end, cancel_at for a set date; null = not ending. */
  cancelAt: number | null;
}

/** cancel_at_period_end / cancel_at off a subscription object -> the end date in ms, or null. */
export function cancelAtFrom(sub: { cancel_at_period_end?: unknown; cancel_at?: unknown }, periodEndMs: number | null): number | null {
  if (typeof sub.cancel_at === "number" && sub.cancel_at > 0) return sub.cancel_at * 1000;
  return sub.cancel_at_period_end === true ? periodEndMs : null;
}

export async function fetchSubscription(subscriptionId: string): Promise<SubscriptionState> {
  const sub = await stripeRequest<{
    status: string;
    current_period_end?: number;
    cancel_at_period_end?: boolean;
    cancel_at?: number | null;
    items?: { data?: { current_period_end?: number; price?: { id?: string } }[] };
  }>(`subscriptions/${subscriptionId}`);
  const item = sub.items?.data?.[0];
  const end = item?.current_period_end ?? sub.current_period_end ?? null;
  const periodEnd = end ? end * 1000 : null;
  return {
    status: sub.status,
    periodEnd,
    plan: planForPrice(item?.price?.id),
    priceId: item?.price?.id ?? null,
    cancelAt: cancelAtFrom(sub, periodEnd),
  };
}

/** A Stripe invoice as far as scan crediting reads it (both API shapes; billingCredits.ts normalises). */
export type StripeObject = Record<string, unknown>;

/** Paid invoices created since `createdGte` (seconds), 100 a page, newest first; the reconcile job walks it. */
export async function listPaidInvoices(createdGte: number, startingAfter?: string): Promise<{ data: StripeObject[]; hasMore: boolean }> {
  const q = `invoices?status=paid&limit=100&created[gte]=${Math.floor(createdGte)}${startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : ""}`;
  const res = await stripeRequest<{ data?: StripeObject[]; has_more?: boolean }>(q);
  return { data: res.data ?? [], hasMore: res.has_more === true };
}

/** One customer's recently paid invoices, newest first (one GET, no writes at Stripe): the deploy-day heal for an account whose payment predates the webhook. */
export async function listCustomerPaidInvoices(customerId: string, createdGte: number): Promise<{ data: StripeObject[]; hasMore: boolean }> {
  const res = await stripeRequest<{ data?: StripeObject[]; has_more?: boolean }>(
    `invoices?status=paid&limit=20&customer=${encodeURIComponent(customerId)}&created[gte]=${Math.floor(createdGte)}`,
  );
  return { data: res.data ?? [], hasMore: res.has_more === true };
}

/** A charge, for a refund or dispute that names only the charge id. */
export async function fetchCharge(chargeId: string): Promise<StripeObject> {
  return stripeRequest<StripeObject>(`charges/${encodeURIComponent(chargeId)}`);
}

/**
 * The invoice a payment intent paid, or null (a one-time Scan Pack has none).
 * Basil-era API: GET /invoice_payments filtered by payment intent.
 */
export async function invoiceIdForPaymentIntent(paymentIntent: string): Promise<string | null> {
  const res = await stripeRequest<{ data?: { invoice?: string | { id?: string } }[] }>(
    `invoice_payments?payment[type]=payment_intent&payment[payment_intent]=${encodeURIComponent(paymentIntent)}&limit=1`,
  );
  const inv = res.data?.[0]?.invoice;
  return typeof inv === "string" ? inv : inv?.id ?? null;
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
