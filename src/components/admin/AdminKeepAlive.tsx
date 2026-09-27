"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";

/**
 * Console idle timeout. The owner's cookie lives 8 hours (Chris 09-27), the
 * helper's 5 minutes (Chris 09-10); this keeps it fresh while the person is
 * actually here — a touch every minute if they clicked, typed or scrolled
 * since the last one and the tab is visible. Past the quiet limit the server
 * refuses the cookie, so the page goes to the login itself instead of
 * failing quietly on the next save. The client only knows the owner's limit;
 * the helper is bounced by the 401 on her next touch.
 */
const IDLE_MS = 8 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

export default function AdminKeepAlive() {
  const router = useRouter();
  const lastActive = useRef(0);
  const lastTouch = useRef(0);

  useEffect(() => {
    lastActive.current = Date.now();
    lastTouch.current = Date.now();
    const active = () => { lastActive.current = Date.now(); };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "touchstart"];
    for (const e of events) window.addEventListener(e, active, { passive: true });

    async function touch() {
      lastTouch.current = Date.now();
      try {
        const res = await fetch(apiPath("/api/admin/touch"), { method: "POST" });
        if (res.status === 401) {
          router.replace("/admin/login");
          router.refresh();
        }
      } catch {
        /* offline: try again next tick */
      }
    }

    const tick = setInterval(() => {
      const now = Date.now();
      if (now - lastActive.current >= IDLE_MS) {
        clearInterval(tick);
        router.replace("/admin/login");
        router.refresh();
        return;
      }
      if (document.visibilityState !== "visible") return;
      if (lastActive.current > lastTouch.current && now - lastTouch.current >= TOUCH_EVERY_MS) void touch();
    }, 15_000);

    // Coming back to the tab after a while: the cookie may be gone already.
    const onVisible = () => { if (document.visibilityState === "visible") void touch(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      for (const e of events) window.removeEventListener(e, active);
    };
  }, [router]);

  return null;
}
