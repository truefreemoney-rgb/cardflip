"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { inPreviewFrame } from "@/lib/client/framed";
import { inAppMode } from "@/lib/appMode";

/**
 * Analytics (GA4, TikTok pixel, the UK/IE consent bar) stays out of the
 * first-paint bundle: its chunk is fetched only once the browser is idle
 * after hydration. Every event it sends is unchanged, just a moment later.
 */
const GoogleAnalytics = dynamic(() => import("@/components/GoogleAnalytics"), { ssr: false });

export default function DeferredAnalytics() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // The admin heat map's page preview sends no analytics (lib/client/framed.ts).
    if (inPreviewFrame()) return;
    // Pages shown inside the iPhone app (lib/appMode.ts) send no GA4 / TikTok pixel: Apple counts the pixel as
    // tracking (App Privacy, 10-29 App Store prep); the app's own usage is measured server-side like everything else.
    if (inAppMode()) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(() => setReady(true), { timeout: 2000 });
      return () => w.cancelIdleCallback?.(h);
    }
    const t = setTimeout(() => setReady(true), 1);
    return () => clearTimeout(t);
  }, []);
  return ready ? <GoogleAnalytics /> : null;
}
