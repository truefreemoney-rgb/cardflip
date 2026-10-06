"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * Analytics (GA4, TikTok pixel, the UK/IE consent bar) stays out of the
 * first-paint bundle: its chunk is fetched only once the browser is idle
 * after hydration. Every event it sends is unchanged, just a moment later.
 */
const GoogleAnalytics = dynamic(() => import("@/components/GoogleAnalytics"), { ssr: false });

export default function DeferredAnalytics() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
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
