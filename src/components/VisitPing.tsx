"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

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
    const ref = referrerSent ? "" : document.referrer;
    referrerSent = true;
    const body = JSON.stringify(ref ? { path: pathname, ref } : { path: pathname });
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
