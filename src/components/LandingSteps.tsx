"use client";

import { useEffect } from "react";

/**
 * Funnel steps for a landing page (10-06, the /scan vs home split test): rides the visit counter as
 * `${prefix}/stay10` (page visible 10 s) and `${prefix}/tap` (any touch or click), one row per visitor per
 * day, same as TrialScanner's /scan steps. Renders nothing. Read by /admin/adtest.
 */
export function landingStep(path: string) {
  fetch("/api/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }), keepalive: true }).catch(() => {});
}

export default function LandingSteps({ prefix }: { prefix: string }) {
  useEffect(() => {
    let shown = 0;
    let sent = false;
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") shown++;
      if (shown >= 10 && !sent) {
        sent = true;
        landingStep(`${prefix}/stay10`);
        window.clearInterval(tick);
      }
    }, 1000);
    const onTap = () => {
      landingStep(`${prefix}/tap`);
      window.removeEventListener("pointerdown", onTap, true);
    };
    window.addEventListener("pointerdown", onTap, true);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("pointerdown", onTap, true);
    };
  }, [prefix]);
  return null;
}
