"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { sourceParam } from "@/lib/attribution";

/**
 * Daily-visitor counter for the admin console (09-25). On every public page
 * (client-side navigations included) send the path to /api/visit, which
 * keeps one anonymous row per visitor per day. Admin pages never ping.
 * sendBeacon so a closing tab still delivers it; fetch keepalive otherwise.
 */
// document.referrer is the page that brought this tab here and stays fixed
// across client-side navigations, so it is sent with the FIRST ping only —
// otherwise every later path would look like it came from that site too.
let referrerSent = false;

export default function VisitPing() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    const first = !referrerSent;
    const ref = first ? document.referrer : "";
    referrerSent = true;
    // The tagged link's source and campaign ride the first ping too (lib/attribution.ts); the server keeps only the classified source.
    const q = first ? new URLSearchParams(window.location.search) : null;
    const utm_source = q ? sourceParam(q) : null;
    const utm_campaign = q?.get("utm_campaign");
    const body = JSON.stringify({ path: pathname, ...(first ? { first: true } : {}), ...(ref ? { ref } : {}), ...(utm_source ? { utm_source } : {}), ...(utm_campaign ? { utm_campaign } : {}) });
    try {
      if (
        !navigator.sendBeacon?.(
          "/api/visit",
          new Blob([body], { type: "application/json" }),
        )
      ) {
        void fetch("/api/visit", {
          method: "POST",
          body,
          keepalive: true,
          headers: { "content-type": "application/json" },
        }).catch(() => {});
      }
    } catch {
      // Never let counting touch the page.
    }
  }, [pathname]);
  return null;
}
