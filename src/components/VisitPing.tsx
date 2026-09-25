"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Daily-visitor counter for the admin console (09-25). On every public page
 * (client-side navigations included) send the path to /api/visit, which
 * keeps one anonymous row per visitor per day. Admin pages never ping.
 * sendBeacon so a closing tab still delivers it; fetch keepalive otherwise.
 */
export default function VisitPing() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    const body = JSON.stringify({ path: pathname });
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
