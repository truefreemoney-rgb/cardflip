import { useEffect } from "react";
import { Alert, Linking, Platform } from "react-native";
import { ErrorCode, deepLinkToSubscriptions, fetchProducts, finishTransaction, initConnection, purchaseErrorListener, purchaseUpdatedListener, requestPurchase, type Purchase } from "expo-iap";
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

/** The buy button on a page inside the app: Apple's sheet for that plan. The result arrives in useIapListener. */
export async function buyPlan(plan: IapPlan, user: SessionUser | null | undefined): Promise<void> {
  if (!IAP_ON || !user) return;
  try {
    await connect();
    const sku = IAP_SKUS[plan];
    // appAccountToken = the account id (a UUID), so Apple's renewal notices name the account on the server.
    if (plan === "pack") await requestPurchase({ type: "in-app", request: { apple: { sku, appAccountToken: user.id } } });
    else await requestPurchase({ type: "subs", request: { apple: { sku, appAccountToken: user.id } } });
  } catch (err) {
    if ((err as { code?: string })?.code === ErrorCode.UserCancelled) return;
    Alert.alert("Couldn't open the App Store", "Check your connection and try again.");
  }
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
    let live = true;
    const done = purchaseUpdatedListener(async (purchase: Purchase) => {
      const jws = purchase.purchaseToken;
      if (!jws) return;
      try {
        await api("/api/iap/apple", { body: { signedTransaction: jws }, timeoutS: 30 });
      } catch (err) {
        // Not finished = StoreKit offers it again next launch. A refusal that will never pass (another account's
        // purchase) is finished so it stops coming back, and said once.
        if (err instanceof ApiError && err.status === 409) {
          await finishTransaction({ purchase, isConsumable: CONSUMABLES.has(purchase.productId) }).catch(() => {});
          Alert.alert("Purchase not added", err.message);
        } else {
          Alert.alert("Purchase received", "Apple took the payment, but CardFlip couldn't add it yet. It will be added the next time you open the app.");
        }
        return;
      }
      await finishTransaction({ purchase, isConsumable: CONSUMABLES.has(purchase.productId) }).catch(() => {});
      if (!live) return;
      await refresh();
      for (const fn of listeners) fn();
    });
    const failed = purchaseErrorListener((e) => {
      if (e.code === ErrorCode.UserCancelled) return;
      Alert.alert("Purchase didn't go through", e.message || "Nothing was charged. Try again.");
    });
    // Connecting also replays purchases that never reached the server (StoreKit's unfinished transactions).
    connect().catch(() => {});
    return () => {
      live = false;
      done.remove();
      failed.remove();
    };
  }, [signedIn, refresh]);
}

/** Rendered inside AuthProvider (app/_layout.tsx). */
export function IapListener(): null {
  useIapListener();
  return null;
}
