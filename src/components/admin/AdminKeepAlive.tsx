"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";

/**
 * Console idle timeout (Chris, 09-10: "time out users after 5 minutes").
 * The cookie lives 5 minutes; this keeps it fresh while the person is
 * actually here — a touch every minute if they clicked, typed or scrolled
 * since the last one and the tab is visible. Five quiet minutes: the
 * server already refuses the cookie, so the page goes to the login itself
 * instead of failing quietly on the next save.
 */
const IDLE_MS = 5 * 60 * 1000;
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
