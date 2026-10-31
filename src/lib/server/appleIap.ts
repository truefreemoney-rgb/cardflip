import "server-only";
import {
  Environment,
  NotificationTypeV2,
  SignedDataVerifier,
  Subtype,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { PRICING } from "@/lib/pricing";
import { APPLE_BUNDLE_ID } from "@/lib/server/appleAuth";
import { APPLE_ROOT_CA_G3 } from "@/lib/server/appleRootCa";
import { reportServerError } from "@/lib/server/errorLog";
import { creditForInvoice, creditPlanScans, reversePlanScans } from "@/lib/server/scanCredits";
import {
  creditScanPack,
  findUserByAppleOriginalTransaction,
  findUserById,
  isSubscribed,
  PLAN_SCANS,
  reverseScanPack,
  setAppleSubscription,
  setSubscription,
  type Plan,
  type User,
} from "@/lib/server/users";

/**
 * Apple in-app purchase, the iPhone app only (10-31, Chris: Apple's own purchase sheet in the app, Stripe stays on
 * the website). Same products and the same scan rules as Stripe:
 *  - Booster (consumable): +100 pack scans, keyed by the Apple transaction id (scan_pack_purchases).
 *  - CardFlip / Pro (auto-renewable, one group): every paid period credits the plan's scans into the rollover
 *    balance, keyed `apple:<transactionId>` in scan_credits exactly like a Stripe invoice id, and sub_* mirror the
 *    subscription with sub_source = 'apple' (users.apple_original_transaction_id pins which one).
 * Two writers, both idempotent: POST /api/iap/apple (the app, right after a purchase, so scans land before the sheet
 * closes) and POST /api/iap/apple/notify (App Store Server Notifications V2: renewals, expiry, refunds).
 * Everything Apple signs is checked against Apple's root CA (lib/server/appleRootCa.ts) before it is read.
 */
export const APPLE_APP_ID = Number(process.env.APPLE_APP_ID || 6828698882);

export type AppleProduct = { kind: "pack"; scans: number } | { kind: "plan"; plan: Plan };
/** App Store Connect product ids (set up 10-31). */
export const APPLE_PRODUCTS: Record<string, AppleProduct> = {
  "io.cardflip.app.booster100": { kind: "pack", scans: PRICING.pack.scans },
  "io.cardflip.app.standard.monthly": { kind: "plan", plan: "standard" },
  "io.cardflip.app.pro.monthly": { kind: "plan", plan: "pro" },
};

/**
 * The ledger key a purchase credits under (scan_credits / scan_pack_purchases). Sandbox purchases (TestFlight, App
 * Review: Apple charges nothing) get their own prefix, which the sales numbers leave out (analytics.ts, 10-31:
 * Chris's two TestFlight Boosters showed as paid).
 */
export const SANDBOX_KEY_PREFIX = "apple-sandbox:";
export const appleKey = (transactionId: string, sandbox = false) => `${sandbox ? SANDBOX_KEY_PREFIX : "apple:"}${transactionId}`;
const inSandbox = (tx: Pick<JWSTransactionDecodedPayload, "environment">) => tx.environment === Environment.SANDBOX;

let verifiers: SignedDataVerifier[] | null = null;
/** Production first (store customers), then Sandbox (TestFlight, App Review, sandbox testers). */
function allVerifiers(): SignedDataVerifier[] {
  if (!verifiers) {
    const roots = [Buffer.from(APPLE_ROOT_CA_G3, "base64")];
    verifiers = [
      new SignedDataVerifier(roots, true, Environment.PRODUCTION, APPLE_BUNDLE_ID, APPLE_APP_ID),
      new SignedDataVerifier(roots, true, Environment.SANDBOX, APPLE_BUNDLE_ID),
    ];
  }
  return verifiers;
}

async function firstThatVerifies<T>(fn: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
  let last: unknown = null;
  for (const v of allVerifiers()) {
    try {
      return await fn(v);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Apple signature check failed");
}

export const verifyTransaction = (jws: string) => firstThatVerifies((v) => v.verifyAndDecodeTransaction(jws));
export const verifyRenewalInfo = (jws: string) => firstThatVerifies((v) => v.verifyAndDecodeRenewalInfo(jws));
export const verifyNotification = (jws: string) => firstThatVerifies((v) => v.verifyAndDecodeNotification(jws));

export type ApplyResult =
  | { result: "credited" | "already" | "status"; scans?: number }
  | { result: "unknown_product" | "revoked" | "not_paid" | "other_account"; note?: string };

/**
 * Credit one verified transaction to `user` and, for a live subscription, mirror its status. Safe to call twice for
 * the same transaction (the app and the notification both do): the ledger key makes the second a no-op.
 */
export async function applyTransaction(user: User, tx: JWSTransactionDecodedPayload, source: "app" | "notification", now = Date.now()): Promise<ApplyResult> {
  const txId = tx.transactionId ?? "";
  const product = tx.productId ? APPLE_PRODUCTS[tx.productId] : undefined;
  if (!txId || !product) {
    await reportServerError("apple iap: unknown product", new Error(`transaction ${txId || "?"} for ${user.id.slice(0, 8)} is product ${tx.productId ?? "none"}, not in APPLE_PRODUCTS: nothing credited`));
    return { result: "unknown_product", note: tx.productId };
  }
  if (tx.revocationDate) return { result: "revoked" };
  // A free offer period (introductory / promotional at $0) credits nothing, like a $0 Stripe checkout.
  if (typeof tx.price === "number" && tx.price <= 0) return { result: "not_paid" };

  if (product.kind === "pack") {
    const key = appleKey(txId, inSandbox(tx));
    const credited = await creditScanPack(user.id, key, product.scans, key);
    console.info(`apple: ${user.email} Booster ${credited ? `+${product.scans}` : "already credited"} (${txId}, ${source})`);
    return credited ? { result: "credited", scans: product.scans } : { result: "already" };
  }

  const otid = tx.originalTransactionId ?? txId;
  const owner = await findUserByAppleOriginalTransaction(otid);
  if (owner && owner.id !== user.id) return { result: "other_account", note: owner.id.slice(0, 8) };

  // An upgraded-away transaction (CardFlip -> Pro) is replaced by the Pro one: only that one counts.
  const out = tx.isUpgraded
    ? { recorded: false, applied: 0 }
    : await creditPlanScans({
        userId: user.id,
        key: appleKey(txId, inSandbox(tx)),
        kind: "payment",
        plan: product.plan,
        scans: PLAN_SCANS[product.plan],
        note: `apple ${source}: ${tx.transactionReason ?? "purchase"}`,
        seed: false,
        now,
      });

  // Status: a period still running makes the account an Apple subscriber, unless a live Stripe subscription already
  // mirrors it (the app never offers a second plan then; if it happens anyway, someone has to look).
  const live = typeof tx.expiresDate === "number" && tx.expiresDate > now && !tx.isUpgraded;
  if (live) {
    if (user.subSource === "stripe" && isSubscribed(user, now)) {
      await reportServerError("apple iap: second subscription", new Error(`${user.id.slice(0, 8)} has a live Stripe subscription and bought ${tx.productId} in the app (${otid}): scans credited, status left on Stripe; refund one of them`));
    } else {
      await setAppleSubscription(user.id, otid);
      await setSubscription(user.id, "active", tx.expiresDate!, product.plan);
    }
  }
  console.info(`apple: ${user.email} ${product.plan} ${out.recorded ? `+${out.applied}` : "already credited"} (${txId}, ${source})`);
  return out.recorded ? { result: "credited", scans: out.applied } : live ? { result: "status" } : { result: "already" };
}

/** Whose purchase this is: the appAccountToken the app set (the user id), else the pinned subscription. */
export async function userForTransaction(tx: Pick<JWSTransactionDecodedPayload, "appAccountToken" | "originalTransactionId">): Promise<User | null> {
  if (tx.appAccountToken) {
    const u = await findUserById(tx.appAccountToken.toLowerCase());
    if (u) return u;
  }
  return tx.originalTransactionId ? findUserByAppleOriginalTransaction(tx.originalTransactionId) : null;
}

/** Take a refunded purchase's scans back (all of it, or Apple's revocationPercentage share) and end a refunded subscription. */
async function applyRefund(user: User, tx: JWSTransactionDecodedPayload): Promise<string> {
  const txId = tx.transactionId ?? "";
  const product = tx.productId ? APPLE_PRODUCTS[tx.productId] : undefined;
  if (!txId || !product) return "unknown product";
  // revocationPercentage is in thousandths of a percent (100000 = all of it); absent = a full refund.
  const fraction = typeof tx.revocationPercentage === "number" ? Math.min(1, Math.max(0, tx.revocationPercentage / 100000)) : 1;
  if (product.kind === "pack") {
    const out = await reverseScanPack(appleKey(txId, inSandbox(tx)), fraction);
    if (out && out.short > 0) await reportServerError("apple iap: refund on Booster scans already used", new Error(`${txId} for ${user.id.slice(0, 8)}: ${out.short} scans already spent`));
    return out ? `Booster -${out.took}` : "no Booster on record";
  }
  const row = await creditForInvoice(appleKey(txId, inSandbox(tx)));
  if (row) {
    const out = await reversePlanScans({ userId: user.id, key: `apple-refund:${txId}`, refKey: row.credit_key, target: Math.round(row.applied * fraction), note: "apple refund" });
    if (!out.recorded) return "already reversed";
  }
  const otid = tx.originalTransactionId ?? txId;
  if (fraction >= 1 && user.subSource === "apple" && user.appleOriginalTransactionId === otid) {
    await setSubscription(user.id, "canceled", user.subPeriodEnd, undefined, null);
  }
  return row ? `plan credit reversed (${Math.round(fraction * 100)}%)` : "no plan credit on record";
}

/**
 * One App Store Server Notification V2, verified. Answers what was done (logged); throws only on a database error,
 * so the route answers 500 and Apple retries.
 */
export async function handleNotification(signedPayload: string): Promise<string> {
  const n = await verifyNotification(signedPayload);
  const type = n.notificationType;
  if (type === NotificationTypeV2.TEST) return "test";
  const signedTx = n.data?.signedTransactionInfo;
  if (!signedTx) return `${type}: no transaction`;
  const tx = await verifyTransaction(signedTx);
  const renewal: JWSRenewalInfoDecodedPayload | null = n.data?.signedRenewalInfo ? await verifyRenewalInfo(n.data.signedRenewalInfo) : null;
  const user = await userForTransaction({ appAccountToken: tx.appAccountToken ?? renewal?.appAccountToken, originalTransactionId: tx.originalTransactionId });
  if (!user) {
    await reportServerError("apple iap: notification with no account", new Error(`${type}/${n.subtype ?? "-"} for ${tx.productId} (${tx.originalTransactionId}) matches no user`));
    return `${type}: no user`;
  }
  const mirrors = user.subSource === "apple" && user.appleOriginalTransactionId === (tx.originalTransactionId ?? tx.transactionId);

  switch (type) {
    case NotificationTypeV2.SUBSCRIBED:
    case NotificationTypeV2.DID_RENEW:
    case NotificationTypeV2.ONE_TIME_CHARGE:
    case NotificationTypeV2.OFFER_REDEEMED:
    case NotificationTypeV2.DID_CHANGE_RENEWAL_PREF:
      return `${type}: ${(await applyTransaction(user, tx, "notification")).result}`;
    case NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS: {
      if (!mirrors) return `${type}: not the mirrored subscription`;
      const ending = n.subtype === Subtype.AUTO_RENEW_DISABLED;
      await setSubscription(user.id, user.subStatus, user.subPeriodEnd, undefined, ending ? tx.expiresDate ?? user.subPeriodEnd : null);
      return `${type}: ${ending ? "ending" : "renewing"}`;
    }
    case NotificationTypeV2.DID_FAIL_TO_RENEW: {
      if (!mirrors) return `${type}: not the mirrored subscription`;
      // Apple's grace period keeps access while it retries the card; past it (or with no grace period) access stops.
      const grace = n.subtype === Subtype.GRACE_PERIOD && renewal?.gracePeriodExpiresDate;
      await setSubscription(user.id, grace ? "active" : "canceled", grace ? renewal!.gracePeriodExpiresDate! : user.subPeriodEnd);
      return `${type}: ${grace ? "grace period" : "stopped"}`;
    }
    case NotificationTypeV2.EXPIRED:
    case NotificationTypeV2.GRACE_PERIOD_EXPIRED:
    case NotificationTypeV2.REVOKE:
      if (!mirrors) return `${type}: not the mirrored subscription`;
      await setSubscription(user.id, "canceled", user.subPeriodEnd, undefined, null);
      return `${type}: canceled`;
    case NotificationTypeV2.REFUND:
      return `${type}: ${await applyRefund(user, tx)}`;
    default:
      return `${type}: ignored`;
  }
}
