"use client";

import { useEffect, useState } from "react";
import { RESEND_COOLDOWN_SECONDS } from "./emailConfirm";

/**
 * The wait after a sign-in code is mailed before Send a New Code works again
 * (Chris 10-14: "so people dont spam it"). `start()` when a code goes out;
 * `left` is the seconds still to wait, 0 = ready.
 */
export function useResendGap(seconds = RESEND_COOLDOWN_SECONDS): { left: number; start: () => void } {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (until <= Date.now()) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [until]);
  return {
    left: Math.max(0, Math.ceil((until - now) / 1000)),
    start: () => {
      setNow(Date.now());
      setUntil(Date.now() + seconds * 1000);
    },
  };
}
