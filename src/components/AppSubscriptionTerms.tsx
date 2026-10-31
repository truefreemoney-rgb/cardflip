"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { appBuys } from "@/lib/appMode";

const noSubscribe = () => () => {};

/**
 * Apple's subscription disclosure (App Review guideline 3.1.2), shown only inside the iPhone app where the plan
 * buttons open Apple's purchase sheet (lib/appMode.ts appBuys): how it renews, where to cancel, and the Terms and
 * Privacy links (the site footer that carries them is hidden in the app). Nothing on the website itself.
 */
export default function AppSubscriptionTerms({ className = "" }: { className?: string }) {
  // Known only in the browser (the app sets its flag before the page loads); the server render says no.
  const show = useSyncExternalStore(noSubscribe, appBuys, () => false);
  if (!show) return null;
  return (
    <p className={`mx-auto max-w-md text-center text-xs leading-relaxed text-zinc-500 ${className}`}>
      CardFlip and Pro are monthly subscriptions paid through your Apple ID. They renew automatically each month unless
      canceled at least 24 hours before the period ends; cancel any time in iPhone Settings, Subscriptions. The Booster
      is a one-time purchase.{" "}
      <Link href="/terms" className="underline underline-offset-2 hover:text-zinc-300">
        Terms of Use
      </Link>{" "}
      ·{" "}
      <Link href="/privacy" className="underline underline-offset-2 hover:text-zinc-300">
        Privacy Policy
      </Link>
    </p>
  );
}
