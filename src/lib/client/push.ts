"use client";

import { apiFetch, BASE_PATH } from "@/lib/client/basePath";

/**
 * Phone notifications, browser side (Tier 2 #9). The service worker only
 * exists for push (public/sw.js); it is registered lazily from the Account
 * row, and the permission prompt runs inside the tap (browsers require a
 * user gesture). On iPhone this works only from the home-screen app.
 */

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** What the Account row should show right now. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration(`${BASE_PATH}/sw.js`);
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

function toKey(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Ask, subscribe, save. Throws with a sentence the row can show. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone() ? "Add CardFlip to your Home Screen first, then turn this on from there." : "This browser can't show notifications.");
  const cfg = await apiFetch("/api/push").then((r) => r.json()).catch(() => null);
  if (!cfg?.publicKey) throw new Error("Notifications aren't set up on this server yet.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for CardFlip in your phone's settings.");
  const reg = await navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(cfg.publicKey) as BufferSource }));
  const res = await apiFetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new Error("Couldn't save this phone — try again.");
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration(`${BASE_PATH}/sw.js`);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await apiFetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => null);
    await sub.unsubscribe().catch(() => null);
  }
}

/** A banner right now, so the seller sees what one looks like. */
export async function sendTestPush(): Promise<boolean> {
  const res = await apiFetch("/api/push", { method: "PUT" });
  const j = await res.json().catch(() => ({}));
  return Boolean(res.ok && j.sent > 0);
}
