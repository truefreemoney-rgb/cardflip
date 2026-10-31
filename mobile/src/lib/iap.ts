import { useEffect } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import { ErrorCode, deepLinkToSubscriptions, fetchProducts, finishTransaction, getAvailablePurchases, initConnection, purchaseErrorListener, purchaseUpdatedListener, requestPurchase, restorePurchases as restoreApplePurchases, type Purchase } from "expo-iap";
import { API_URL, api, ApiError } from "./api";
import { useAuth, type SessionUser } from "./auth";

/**
 * Apple in-app purchase (10-31, Chris: Apple's own purchase sheet in the app; Stripe stays on cardflip.io).
 * The website pages inside the app keep their buy buttons; in this build they post {type:"buy", plan} over the
 * page bridge (the site's lib/appMode.ts appBuys, switched on by window.CardFlipApp.iap that SiteWebView sets)
 * and land here. Apple's sheet → the signed transaction to POST /api/iap/apple (the server checks it with Apple's
 * keys and credits the scans, same rules as Stripe) → only then finishTransaction, so a purchase that never reached
 * the server is offered again by StoreKit on the next launch instead of being lost.
 */
export const IAP_SKUS = {
  pack: "io.cardflip.app.booster100",
  standard: "io.cardflip.app.standard.monthly",
  pro: "io.cardflip.app.pro.monthly",
} as const;
export type IapPlan = keyof typeof IAP_SKUS;
const CONSUMABLES = new Set<string>([IAP_SKUS.pack]);

/** iOS only: the web preview and Android never sell through Apple. */
export const IAP_ON = Platform.OS === "ios";

let connected: Promise<void> | null = null;
function connect(): Promise<void> {
  if (!connected) {
    connected = (async () => {
      await initConnection();
      // StoreKit sells only products it has loaded in this run.
      await fetchProducts({ skus: [IAP_SKUS.pack], type: "in-app" });
      await fetchProducts({ skus: [IAP_SKUS.standard, IAP_SKUS.pro], type: "subs" });
    })().catch((err) => {
      connected = null;
      throw err;
    });
  }
  return connected;
}

/** Pages that should re-read the account after a purchase (each SiteWebView registers its reload). */
const listeners = new Set<() => void>();
export function onPurchased(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Set by useIapListener: re-read the account (header counter) and tell the pages. */
let afterCredit: (() => Promise<void>) | null = null;
/** Transactions handed to the server in this run (or on their way): each one once, however many paths deliver it. */
const handled = new Set<string>();

/**
 * One Apple purchase to the server, then finishTransaction, then the header and pages re-read the account. Three
 * paths deliver purchases (the sheet's own answer, the listener, the foreground check); the first one wins.
 * Chris 10-31 on build 4: the Booster sheet closed, the counter stayed at 5, and the purchase only reached the server
 * when StoreKit brought it back later, so the listener alone is not enough.
 */
async function handlePurchase(purchase: Purchase): Promise<void> {
  const jws = purchase.purchaseToken;
  const id = purchase.id || jws || "";
  if (!jws || handled.has(id)) return;
  handled.add(id);
  try {
    await api("/api/iap/apple", { body: { signedTransaction: jws }, timeoutS: 30 });
  } catch (err) {
    // Not finished = StoreKit offers it again (next foreground or launch). A refusal that will never pass (another
    // account's purchase) is finished so it stops coming back, and said once.
    if (err instanceof ApiError && err.status === 409) {
      await finishTransaction({ purchase, isConsumable: CONSUMABLES.has(purchase.productId) }).catch(() => {});
      Alert.alert("Purchase not added", err.message);
    } else {
      handled.delete(id);
      Alert.alert("Purchase received", "Apple took the payment, but CardFlip couldn't add it yet. It will be added the next time you open the app.");
    }
    return;
  }
  await finishTransaction({ purchase, isConsumable: CONSUMABLES.has(purchase.productId) }).catch(() => {});
  await afterCredit?.();
}

/**
 * A Booster StoreKit still holds unfinished (never reached the server): checked each time the app comes to the front.
 * Subscriptions are left to Apple's server notices (api/iap/apple/notify), so an active one on a shared phone is not
 * re-sent (and refused as another account's) on every return.
 */
async function reconcile(): Promise<void> {
  try {
    await connect();
    const held = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
    for (const p of held ?? []) if (CONSUMABLES.has(p.productId)) await handlePurchase(p);
  } catch {
    /* offline or StoreKit busy: the next foreground tries again */
  }
}

/** The buy button on a page inside the app: Apple's sheet for that plan, and its answer straight to the server. */
export async function buyPlan(plan: IapPlan, user: SessionUser | null | undefined): Promise<void> {
  if (!IAP_ON || !user) return;
  try {
    await connect();
    const sku = IAP_SKUS[plan];
    // appAccountToken = the account id (a UUID), so Apple's renewal notices name the account on the server.
    const out =
      plan === "pack"
        ? await requestPurchase({ type: "in-app", request: { apple: { sku, appAccountToken: user.id } } })
        : await requestPurchase({ type: "subs", request: { apple: { sku, appAccountToken: user.id } } });
    for (const p of Array.isArray(out) ? out : out ? [out] : []) await handlePurchase(p);
  } catch (err) {
    if ((err as { code?: string })?.code === ErrorCode.UserCancelled) return;
    Alert.alert("Couldn't open the App Store", "Check your connection and try again.");
  }
}

/**
 * Restore Purchases (Account > Plan, App Review 3.1.1): Apple re-syncs this Apple ID's purchases, and each active
 * subscription goes to the server again, which re-links it to this account (the server credits nothing twice). A
 * Booster is consumed once used, so only one still unfinished comes back here.
 */
export async function restorePurchases(user: SessionUser | null | undefined): Promise<void> {
  if (!IAP_ON || !user) return;
  let held: Purchase[] = [];
  try {
    await connect();
    // Apple's sync may ask for the Apple ID password; a cancel there still lists what this phone already knows.
    await restoreApplePurchases().catch(() => {});
    held = (await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true })) ?? [];
  } catch {
    Alert.alert("Couldn't reach the App Store", "Check your connection and try again.");
    return;
  }
  let restored = 0;
  let refusal = "";
  for (const purchase of held) {
    if (!purchase.purchaseToken) continue;
    if (CONSUMABLES.has(purchase.productId)) {
      await handlePurchase(purchase);
      continue;
    }
    try {
      await api("/api/iap/apple", { body: { signedTransaction: purchase.purchaseToken }, timeoutS: 30 });
      await finishTransaction({ purchase, isConsumable: false }).catch(() => {});
      restored++;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) refusal = err.message;
      else {
        Alert.alert("Couldn't restore", "Check your connection and try again.");
        return;
      }
    }
  }
  await afterCredit?.();
  if (restored > 0) Alert.alert("Purchases restored", "Your subscription is active on this account.");
  else if (refusal) Alert.alert("Purchase not added", refusal);
  else Alert.alert("Nothing to restore", "This Apple ID has no active CardFlip subscription.");
}

/** Manage: an Apple subscription in iPhone Settings; a cardflip.io (Stripe) one on the website in Safari. */
export async function manageSubscription(user: SessionUser | null | undefined): Promise<void> {
  if (user?.subSource === "stripe") {
    await Linking.openURL(`${API_URL}/app/account`);
    return;
  }
  try {
    await deepLinkToSubscriptions();
  } catch {
    await Linking.openURL("https://apps.apple.com/account/subscriptions");
  }
}

/** Mounted once while signed in: hands every finished Apple purchase to the server, then tells the pages. */
export function useIapListener(): void {
  const { user, refresh } = useAuth();
  const signedIn = Boolean(user);
  useEffect(() => {
    if (!IAP_ON || !signedIn) return;
    afterCredit = async () => {
      await refresh();
      for (const fn of listeners) fn();
    };
    const done = purchaseUpdatedListener((purchase: Purchase) => void handlePurchase(purchase));
    const failed = purchaseErrorListener((e) => {
      if (e.code === ErrorCode.UserCancelled) return;
      Alert.alert("Purchase didn't go through", e.message || "Nothing was charged. Try again.");
    });
    // Connecting replays purchases that never reached the server; so does every return to the front.
    void reconcile();
    const front = AppState.addEventListener("change", (s) => {
      if (s === "active") void reconcile();
    });
    return () => {
      afterCredit = null;
      done.remove();
      failed.remove();
      front.remove();
    };
  }, [signedIn, refresh]);
}

/** Rendered inside AuthProvider (app/_layout.tsx). */
export function IapListener(): null {
  useIapListener();
  return null;
}
