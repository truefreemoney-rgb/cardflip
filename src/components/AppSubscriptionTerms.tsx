"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { appBuys, appRestores, postToApp } from "@/lib/appMode";

const noSubscribe = () => () => {};

/**
 * Apple's subscription disclosure (App Review guideline 3.1.2), shown only inside the iPhone app where the plan
 * buttons open Apple's purchase sheet (lib/appMode.ts appBuys): how it renews, where to cancel, and the Terms and
 * Privacy links (the site footer that carries them is hidden in the app). Nothing on the website itself. Builds that
 * handle it also get Restore Purchases here (3.1.1), so every screen that sells has one.
 */
export default function AppSubscriptionTerms({ className = "", align = "center" }: { className?: string; align?: "center" | "left" }) {
  // Known only in the browser (the app sets its flag before the page loads); the server render says no.
  const show = useSyncExternalStore(noSubscribe, appBuys, () => false);
  const restore = useSyncExternalStore(noSubscribe, appRestores, () => false);
  if (!show) return null;
  const link = "underline underline-offset-2 hover:text-zinc-300";
  return (
    <p className={`max-w-md text-xs leading-relaxed text-zinc-500 ${align === "center" ? "mx-auto text-center" : ""} ${className}`}>
      CardFlip and Pro are monthly subscriptions paid through your Apple ID. They renew automatically each month unless
      canceled at least 24 hours before the period ends; cancel any time in iPhone Settings, Subscriptions. The Booster
      is a one-time purchase.{" "}
      {restore && (
        <>
          <button type="button" className={`${link} font-semibold text-zinc-300`} onClick={() => postToApp({ type: "restore" })}>
            Restore Purchases
          </button>{" "}
          ·{" "}
        </>
      )}
      {/* target=_blank: the app opens these over the tabs with a Back bar (SiteWebView onOpenWindow). */}
      <Link href="/terms" target="_blank" rel="noopener" className={link}>
        Terms of Use
      </Link>{" "}
      ·{" "}
      <Link href="/privacy" target="_blank" rel="noopener" className={link}>
        Privacy Policy
      </Link>
    </p>
  );
}
