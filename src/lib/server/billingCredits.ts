import "server-only";
import { db } from "@/lib/db";
import { CREDITS_FROM } from "@/lib/planSeed";
import { localPlanCents } from "@/lib/pricing";
import { reportServerError } from "@/lib/server/errorLog";
import {
  creditForCharge,
  creditForInvoice,
  creditPlanScans,
  ledgerKeysPresent,
  markNoSeedOwed,
  recordRefundBeforeCredit,
  rememberCharge,
  reversePlanScans,
} from "@/lib/server/scanCredits";
import {
  fetchCharge,
  invoiceIdForPaymentIntent,
  listCustomerPaidInvoices,
  listPaidInvoices,
  priceInfo,
  stripeConfigured,
  type StripeObject,
  type StripePlan,
  type SubscriptionState,
} from "@/lib/server/stripe";
import { OWNER_EMAIL, findUserById, findUserByStripeCustomer, isSubscribed, planSeedFor, reverseScanPack, spendsPlanScans, type User } from "@/lib/server/users";

/**
 * Turning Stripe money events into scan credits (Chris, 09-30). Scans are
 * credited ONLY from a paid invoice, keyed by the invoice id (ledger:
 * scanCredits.ts), for ANY subscription of the customer; the pinned
 * subscription only mirrors status. Three doors, one credit function:
 * the invoice.paid webhook, checkout completion (the same invoice id, early)
 * and the daily reconcile that catches a missed webhook. Whichever gets there
 * first credits; the rest see the key and do nothing.
 *
 * Stripe's two invoice shapes are both read: the current API keeps the
 * subscription in parent.subscription_details and the price in
 * lines[].pricing.price_details.price, older ones in invoice.subscription and
 * lines[].price.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
/** A Stripe id that may be the string or the expanded object. */
const idOf = (v: unknown): string | null => str(v) ?? (v && typeof v === "object" ? str((v as { id?: unknown }).id) : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export interface InvoiceLine {
  priceId: string | null;
  proration: boolean;
  /** Cents, signed (a proration credit for unused time is negative). */
  amount: number;
}

export function invoiceLines(inv: StripeObject): InvoiceLine[] {
  const data = rec(inv.lines).data;
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const line = rec(raw);
    const details = rec(rec(rec(line.parent).subscription_item_details));
    return {
      priceId: idOf(rec(rec(line.pricing).price_details).price) ?? idOf(line.price),
      proration: line.proration === true || details.proration === true,
      amount: typeof line.amount === "number" ? line.amount : 0,
    };
  });
}

/** The subscription an invoice bills, from either API shape; null for a one-off invoice. */
export function invoiceSubscriptionId(inv: StripeObject): string | null {
  const direct = idOf(rec(rec(inv.parent).subscription_details).subscription) ?? idOf(inv.subscription);
  if (direct) return direct;
  const data = rec(inv.lines).data;
  if (!Array.isArray(data)) return null;
  for (const raw of data) {
    const line = rec(raw);
    const found = idOf(rec(rec(line.parent).subscription_item_details).subscription) ?? idOf(line.subscription);
    if (found) return found;
  }
  return null;
}

export type CreditPlan =
  | { kind: "none"; reason: string }
  | { kind: "unknown_price"; priceId: string }
  | { kind: "payment" | "proration"; plan: StripePlan; scans: number; priceId: string };

/**
 * How many scans a paid invoice buys, worked out from what was sold, never
 * from today's env alone (pricing.ts has the retired ids):
 *  - a regular (non-proration) line on a known price: that plan's scans;
 *  - an upgrade's proration invoice (always_invoice in the portal): only the
 *    difference between the plans, scaled by how much of the period the money
 *    covers, so scans always track dollars kept and the next renewal (at the
 *    new price) does not double-credit;
 *  - an unknown price id: nothing, and the caller reports it.
 */
export function planCreditFor(inv: StripeObject): CreditPlan {
  const lines = invoiceLines(inv);
  const regular = lines.filter((l) => !l.proration && l.priceId);
  if (regular.length > 0) {
    let scans = 0;
    let best: { plan: StripePlan; scans: number; priceId: string } | null = null;
    for (const l of regular) {
      const info = priceInfo(l.priceId);
      if (!info) return { kind: "unknown_price", priceId: l.priceId! };
      scans += info.scans;
      if (!best || info.scans > best.scans) best = { plan: info.plan, scans: info.scans, priceId: l.priceId! };
    }
    return { kind: "payment", plan: best!.plan, scans, priceId: best!.priceId };
  }

  const pro = lines.filter((l) => l.proration && l.priceId);
  if (pro.length === 0) return { kind: "none", reason: "no subscription line on the invoice" };
  if (str(inv.billing_reason) !== "subscription_update") return { kind: "none", reason: "proration lines outside a plan change" };
  for (const l of pro) if (!priceInfo(l.priceId)) return { kind: "unknown_price", priceId: l.priceId! };
  if (!(typeof inv.amount_paid === "number" && inv.amount_paid > 0)) return { kind: "none", reason: "a plan change that cost nothing credits nothing" };
  const charge = [...pro].filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount)[0];
  const credit = [...pro].filter((l) => l.amount < 0).sort((a, b) => a.amount - b.amount)[0];
  if (!charge || !credit) return { kind: "none", reason: "not a plan-to-plan change" };
  const to = priceInfo(charge.priceId)!;
  const from = priceInfo(credit.priceId)!;
  const extraScans = to.scans - from.scans;
  // Line amounts are in the invoice's currency: a GBP subscriber's upgrade is
  // measured against the GBP price gap, not the USD one (Chris 09-30 local prices).
  const cur = str(inv.currency);
  const localTo = localPlanCents(to.plan, cur);
  const localFrom = localPlanCents(from.plan, cur);
  const extraCents = localTo !== null && localFrom !== null ? localTo - localFrom : to.cents - from.cents;
  if (extraScans <= 0 || extraCents <= 0) return { kind: "none", reason: "a downgrade or same-plan change credits nothing" };
  const net = pro.reduce((sum, l) => sum + l.amount, 0);
  const scans = Math.round(extraScans * Math.min(1, Math.max(0, net / extraCents)));
  if (scans <= 0) return { kind: "none", reason: "the plan change's proration is worth no scans" };
  return { kind: "proration", plan: to.plan, scans, priceId: charge.priceId! };
}

/** When an invoice was paid (ms): Stripe's paid_at, else its creation time. */
export function invoicePaidAt(inv: StripeObject): number {
  const paid = rec(inv.status_transitions).paid_at;
  if (typeof paid === "number") return paid * 1000;
  return typeof inv.created === "number" ? inv.created * 1000 : 0;
}

export interface InvoiceOutcome {
  result: "credited" | "already" | "ignored" | "no_user" | "unknown_price";
  scans?: number;
  note?: string;
}

/** A paying customer whose account carries an admin override: the scans are banked (money arrived), but nobody can spend them until the override goes. */
async function alertIfOverride(user: User, applied: number, invoiceId: string, source: string): Promise<void> {
  if (!user.accessOverride || applied <= 0) return;
  await reportServerError(
    "stripe: paying customer on an override",
    new Error(`${user.id.slice(0, 8)} is on override "${user.accessOverride}" but paid ${invoiceId} (${source}): ${applied} plan scans banked, unusable until the override is cleared`),
  );
}

/** Someone paid on a second live subscription (two checkouts): a duplicate for Chris to cancel and refund by hand. */
async function alertIfSecondPayer(user: User, subscriptionId: string | null, invoiceId: string): Promise<void> {
  if (!subscriptionId || !user.stripeSubscriptionId || subscriptionId === user.stripeSubscriptionId || !isSubscribed(user)) return;
  await reportServerError(
    "stripe: second subscription paid",
    new Error(`${user.id.slice(0, 8)} paid ${invoiceId} on ${subscriptionId} while ${user.stripeSubscriptionId} is live: check for a duplicate subscription to cancel and refund`),
  );
}

/**
 * Credit a paid subscription invoice. Never throws for a payload problem (it
 * reports and answers), but a database error propagates so the webhook answers
 * 500 and Stripe retries: the credit is all-or-nothing (scanCredits.ts).
 */
export async function creditPaidInvoice(inv: StripeObject, source: "webhook" | "reconcile" | "first-use"): Promise<InvoiceOutcome> {
  const id = str(inv.id);
  if (!id) return { result: "ignored", note: "invoice without an id" };
  const subscriptionId = invoiceSubscriptionId(inv);
  if (!subscriptionId) return { result: "ignored", note: "not a subscription invoice" };
  if (typeof inv.status === "string" && inv.status !== "paid") return { result: "ignored", note: `invoice is ${inv.status}` };
  if (str(inv.billing_reason) === "manual") return { result: "ignored", note: "manual invoice" };

  const credit = planCreditFor(inv);
  if (credit.kind === "none") return { result: "ignored", note: credit.reason };
  if (credit.kind === "unknown_price") {
    await reportServerError(
      `stripe: unknown price id (${source})`,
      new Error(`invoice ${id} was paid on price ${credit.priceId}, which is not in pricing.ts or the environment: no scans credited. Add the id to PRICE_IDS in src/lib/pricing.ts, or credit by hand with the admin adjust-scans control`),
    );
    return { result: "unknown_price", note: credit.priceId };
  }

  const customerId = idOf(inv.customer);
  const user = customerId ? await findUserByStripeCustomer(customerId) : null;
  if (!user) {
    await reportServerError(
      `stripe: paid invoice with no account (${source})`,
      new Error(`invoice ${id} (${credit.scans} scans on ${credit.priceId}) was paid by customer ${customerId ?? "unknown"}, who matches no user: nothing credited`),
    );
    return { result: "no_user" };
  }

  const firstPayment = str(inv.billing_reason) === "subscription_create";
  const out = await creditPlanScans({
    userId: user.id,
    key: id,
    kind: credit.kind,
    plan: credit.plan,
    scans: credit.scans,
    priceId: credit.priceId,
    chargeId: idOf(inv.charge),
    paymentIntent: idOf(inv.payment_intent),
    note: `${source}: ${str(inv.billing_reason) ?? "invoice"}`,
    // A first payment is a new subscriber: nothing from the old monthly counter is owed to them.
    seed: !firstPayment,
    // ...and a seed the app wrote for them AFTER they paid (old code, deploy later) is taken back.
    firstPaymentPaidAt: firstPayment ? invoicePaidAt(inv) : null,
  });
  if (!out.recorded) return { result: "already" };
  await alertIfOverride(user, out.applied, id, source);
  await alertIfSecondPayer(user, subscriptionId, id);
  console.info(`stripe: ${user.email} +${out.applied} plan scans (${credit.kind}, invoice ${id}, ${source})${out.seedBack ? ` [took back a ${out.seedBack}-scan seed: first payment, nothing owed from the old counter]` : ""}${out.note ? ` [${out.note}]` : ""}`);
  return { result: "credited", scans: out.applied, ...(out.note ? { note: out.note } : {}) };
}

/**
 * Checkout completion credits the first invoice early (so the welcome page
 * finds scans), from the subscription's own price. Same key as invoice.paid.
 */
export async function creditCheckoutInvoice(user: User, invoiceId: string, sub: SubscriptionState): Promise<InvoiceOutcome> {
  const info = priceInfo(sub.priceId);
  if (!info) {
    await reportServerError(
      "stripe: unknown price id (checkout)",
      new Error(`checkout for ${user.id.slice(0, 8)} (invoice ${invoiceId}) is on price ${sub.priceId ?? "none"}, which is not in pricing.ts or the environment: no scans credited`),
    );
    return { result: "unknown_price", ...(sub.priceId ? { note: sub.priceId } : {}) };
  }
  const out = await creditPlanScans({ userId: user.id, key: invoiceId, kind: "payment", plan: info.plan, scans: info.scans, priceId: sub.priceId, note: "checkout: subscription_create", seed: false });
  if (!out.recorded) return { result: "already" };
  await alertIfOverride(user, out.applied, invoiceId, "checkout");
  console.info(`stripe: ${user.email} +${out.applied} plan scans (checkout, invoice ${invoiceId})`);
  return { result: "credited", scans: out.applied };
}

// --- refunds and disputes ---------------------------------------------------------

export interface ReversalOutcome {
  result: "reversed" | "ignored" | "no_credit" | "nothing_more";
  scans?: number;
  note?: string;
}

/**
 * Which credit a charge paid for. The ledger first (the charge or payment
 * intent saved at credit time), then what the event itself names, then Stripe
 * (the charge, then the invoice paid by its payment intent). null invoice =
 * not a subscription payment (a Booster refund lands here).
 */
async function creditBehind(chargeId: string | null, paymentIntent: string | null, invoiceId: string | null, customerId: string | null) {
  let row = await creditForCharge(chargeId, paymentIntent);
  if (!row && invoiceId) row = await creditForInvoice(invoiceId);
  let pi = paymentIntent;
  let cus = customerId;
  let inv = invoiceId;
  if (!row && !inv && chargeId) {
    // Most events already name the payment intent; the charge is fetched only when nothing else does.
    if (!pi) {
      const charge = await fetchCharge(chargeId);
      inv = idOf(charge.invoice);
      pi = idOf(charge.payment_intent);
      cus = cus ?? idOf(charge.customer);
    }
    if (!inv && pi) inv = await invoiceIdForPaymentIntent(pi);
    if (inv) row = await creditForInvoice(inv);
  }
  if (row) await rememberCharge(row.credit_key, chargeId, pi);
  return { row, invoiceId: row?.credit_key ?? inv, customerId: cus, paymentIntent: pi };
}

/** Not a subscription payment: maybe a Booster (10-01 sweep: its scans were kept on a refund or chargeback). */
async function reversePack(kind: "refund" | "dispute", paymentIntent: string | null, fraction: number): Promise<ReversalOutcome> {
  const out = paymentIntent ? await reverseScanPack(paymentIntent, fraction) : null;
  if (!out) return { result: "ignored", note: "not a subscription payment or a known Booster" };
  if (out.short > 0) {
    await reportServerError(
      `stripe: ${kind} on Booster scans already used`,
      new Error(`${kind} on pack ${paymentIntent} for ${out.userId.slice(0, 8)}: ${out.took + out.short} scans to take back, only ${out.took} were unspent`),
    );
  }
  console.info(`stripe: ${kind} on Booster ${paymentIntent}: -${out.took} pack scans`);
  return out.took + out.short > 0 ? { result: "reversed", scans: out.took } : { result: "nothing_more" };
}

async function reverseCredit(kind: "refund" | "dispute", key: string, row: { credit_key: string; user_id: string; applied: number }, fraction: number, chargeId: string | null): Promise<ReversalOutcome> {
  const target = Math.round(row.applied * Math.min(1, Math.max(0, fraction)));
  // What earlier refunds already took is netted inside the write transaction
  // (reversePlanScans), so concurrent events for one charge cannot both take it.
  const out = await reversePlanScans({ userId: row.user_id, key, refKey: row.credit_key, target, chargeId, note: kind });
  if (!out.recorded) return { result: "nothing_more", note: out.note };
  const delta = out.wanted ?? target;
  const took = -out.applied;
  if (took < delta) {
    await reportServerError(
      `stripe: ${kind} on scans already used`,
      new Error(`${kind} on invoice ${row.credit_key} for ${row.user_id.slice(0, 8)}: ${delta} scans to take back, only ${took} were still on the plan balance`),
    );
  }
  console.info(`stripe: ${kind} on invoice ${row.credit_key}: -${took} plan scans (of ${delta})`);
  return { result: "reversed", scans: took };
}

/** charge.refunded: take back the credit in proportion to what was refunded (a partial refund takes a share, later ones the rest). */
export async function handleChargeRefunded(charge: StripeObject): Promise<ReversalOutcome> {
  const chargeId = str(charge.id);
  if (!chargeId) return { result: "ignored", note: "charge without an id" };
  const amount = typeof charge.amount === "number" ? charge.amount : 0;
  const refunded = typeof charge.amount_refunded === "number" ? charge.amount_refunded : 0;
  if (amount <= 0 || refunded <= 0) return { result: "ignored", note: "nothing refunded" };
  const found = await creditBehind(chargeId, idOf(charge.payment_intent), idOf(charge.invoice), idOf(charge.customer));
  if (!found.row) {
    if (!found.invoiceId) return reversePack("refund", found.paymentIntent, refunded / amount);
    // Refunded in full before its credit was written (a late webhook or reconcile): mark it so the credit lands as 0.
    if (refunded >= amount && found.customerId) {
      const user = await findUserByStripeCustomer(found.customerId);
      if (user) await recordRefundBeforeCredit(user.id, `refund:${chargeId}:${refunded}`, found.invoiceId, chargeId);
    }
    return { result: "no_credit", note: found.invoiceId };
  }
  return reverseCredit("refund", `refund:${chargeId}:${refunded}`, found.row, refunded / amount, chargeId);
}

/** charge.dispute.created: a chargeback takes the whole credit back (a won dispute is put right by hand with the admin adjust-scans control). */
export async function handleDisputeCreated(dispute: StripeObject): Promise<ReversalOutcome> {
  const disputeId = str(dispute.id);
  const chargeId = idOf(dispute.charge);
  if (!disputeId || !chargeId) return { result: "ignored", note: "dispute without a charge" };
  const found = await creditBehind(chargeId, idOf(dispute.payment_intent), null, null);
  if (!found.row) return found.invoiceId ? { result: "no_credit", note: found.invoiceId } : reversePack("dispute", found.paymentIntent, 1);
  return reverseCredit("dispute", `dispute:${disputeId}`, found.row, 1, chargeId);
}

// --- first use, deploy day ---------------------------------------------------------

/**
 * A live subscriber whose balance is still NULL and who owes no seed (an
 * account made on or after CREDITS_FROM, so its payment happened under the old
 * code, which handed out the scans at once and sent this code no invoice.paid).
 * Left alone they read 0 and hit the 402 wall until the daily reconcile ran.
 */
export function needsFirstUseCredit(user: User, now = Date.now()): boolean {
  return Boolean(user.stripeCustomerId) && user.planScans === null && spendsPlanScans(user) && planSeedFor(user, now) === null;
}

/** A Stripe outage must not turn every request of such an account into a Stripe call: one try a minute per account. */
const healTried = new Map<string, number>();
const HEAL_RETRY_MS = 60_000;

/**
 * Credit that customer's paid invoices now (the same idempotent credit as the
 * webhook and the daily reconcile: whichever comes first wins, the rest see the
 * invoice id), then mark the balance 0 if nothing was owed so the check stops
 * asking Stripe. Best effort: any failure is reported and the caller carries on
 * with the row it had. Returns the fresh row when it changed.
 */
export async function creditFirstUse(user: User, opts: { now?: number; list?: typeof listCustomerPaidInvoices } = {}): Promise<User> {
  const now = opts.now ?? Date.now();
  if (!needsFirstUseCredit(user, now)) return user;
  const list = opts.list ?? listCustomerPaidInvoices;
  if (!opts.list && !stripeConfigured()) return user;
  const last = healTried.get(user.id);
  if (last !== undefined && now - last < HEAL_RETRY_MS) return user;
  healTried.set(user.id, now);
  try {
    const got = await list(user.stripeCustomerId!, Math.floor(CREDITS_FROM / 1000));
    for (const inv of got.data) {
      if (invoicePaidAt(inv) < CREDITS_FROM) continue;
      await creditPaidInvoice(inv, "first-use");
    }
    await markNoSeedOwed(user.id);
    healTried.delete(user.id);
    return (await findUserById(user.id)) ?? user;
  } catch (err) {
    await reportServerError("billing/first-use credit", err);
    return user;
  }
}

// --- daily reconcile ---------------------------------------------------------------

export interface ReconcileResult {
  skipped?: string;
  error?: string;
  /** Paid invoices looked at (already in the ledger, too). */
  checked: number;
  /** Missing invoices credited now (each older than an hour was a webhook that never arrived). */
  credited: number;
  /** Paid before rollover began (CREDITS_FROM): the seed stands for them. */
  before: number;
  unknownPrice: number;
  noUser: number;
  failed: number;
  pages: number;
  /** The time or page cap stopped the walk early; tomorrow picks it up. */
  partial?: boolean;
  /** Live subscribers with no credit in 35 days (reported, not fixed). */
  stale?: number;
}

const DAY_MS = 86_400_000;
const LIVE_STATUSES = "'active', 'trialing', 'past_due'";

/**
 * Catch a missed webhook: walk the account's recently PAID invoices (one GET
 * per 100, no writes at Stripe) and push each one the ledger has not seen
 * through the same idempotent credit. Time-capped and page-capped; failures go
 * to the Errors page and never throw. Also flags live subscribers who have had
 * no credit for 35 days. A lookback longer than Stripe's retry window covers a
 * webhook endpoint that was down or not yet subscribed to invoice.paid.
 */
export async function reconcilePaidInvoices(
  opts: {
    now?: number;
    lookbackMs?: number;
    budgetMs?: number;
    maxPages?: number;
    /** Invoices paid before this are the seed's business (default CREDITS_FROM). */
    creditsFrom?: number;
    list?: typeof listPaidInvoices;
  } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? Date.now();
  const list = opts.list ?? listPaidInvoices;
  const res: ReconcileResult = { checked: 0, credited: 0, before: 0, unknownPrice: 0, noUser: 0, failed: 0, pages: 0 };
  if (!opts.list && !stripeConfigured()) return { ...res, skipped: "stripe is not configured here" };
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const creditsFrom = opts.creditsFrom ?? CREDITS_FROM;
  const createdGte = Math.floor((now - (opts.lookbackMs ?? 35 * DAY_MS)) / 1000);
  try {
    let after: string | undefined;
    let missed = 0;
    walk: for (let page = 0; page < (opts.maxPages ?? 10); page++) {
      if (Date.now() > deadline) {
        res.partial = true;
        break;
      }
      const got = await list(createdGte, after);
      res.pages++;
      const ids = got.data.map((i) => str(i.id)).filter((x): x is string => x !== null);
      const known = await ledgerKeysPresent(ids);
      for (const inv of got.data) {
        const id = str(inv.id);
        if (!id) continue;
        res.checked++;
        if (known.has(id)) continue;
        if (Date.now() > deadline) {
          res.partial = true;
          break walk;
        }
        const paidAt = invoicePaidAt(inv);
        if (paidAt < creditsFrom) {
          res.before++;
          continue;
        }
        try {
          const out = await creditPaidInvoice(inv, "reconcile");
          if (out.result === "credited") {
            res.credited++;
            if (now - paidAt > 3_600_000) missed++;
          }
          else if (out.result === "unknown_price") res.unknownPrice++;
          else if (out.result === "no_user") res.noUser++;
        } catch (err) {
          res.failed++;
          await reportServerError("billing/reconcile invoice", err);
        }
      }
      if (!got.hasMore || ids.length === 0) break;
      after = ids[ids.length - 1];
      if (page === (opts.maxPages ?? 10) - 1) res.partial = true;
    }
    if (missed > 0) {
      await reportServerError("billing/reconcile credited missed payments", new Error(`${missed} paid invoice(s) had no credit and were credited now: check that invoice.paid reaches the webhook`));
    }
  } catch (err) {
    res.error = err instanceof Error ? err.message : String(err);
    await reportServerError("billing/reconcile", err);
  }
  try {
    const stale = (await db
      .prepare(
        `SELECT id FROM users u
         WHERE sub_status IN (${LIVE_STATUSES}) AND access_override IS NULL AND role <> 'admin' AND LOWER(email) <> ?
           AND NOT EXISTS (SELECT 1 FROM scan_credits c WHERE c.user_id = u.id AND c.kind IN ('payment', 'proration', 'migration') AND c.created_at > ?)
         LIMIT 20`,
      )
      .all(OWNER_EMAIL, now - 35 * DAY_MS)) as { id: string }[];
    if (stale.length > 0) {
      res.stale = stale.length;
      await reportServerError(
        "billing/reconcile no recent credit",
        new Error(`${stale.length} live subscriber(s) have no scan credit in 35 days (${stale.slice(0, 5).map((s) => s.id.slice(0, 8)).join(", ")}): check their invoices in Stripe`),
      );
    }
  } catch (err) {
    await reportServerError("billing/reconcile stale check", err);
  }
  return res;
}
