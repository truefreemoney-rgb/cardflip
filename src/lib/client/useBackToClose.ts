"use client";

import { useEffect, useRef } from "react";

/**
 * Android's back button (and the iOS back-swipe) closes the SHEET, not the
 * app. On open push a history entry tagged with the sheet's id; a popstate
 * that removes it calls `onClose`. A programmatic close (X, backdrop, Esc)
 * pops that entry itself so the stack doesn't collect dead sheet frames —
 * and the pop must not fire `onClose` again, hence the `popped` guard.
 *
 * `onClose` rides on a ref: sheets pass inline arrows, and the effect must
 * run once per open, not once per parent render. SSR-safe: nothing runs
 * without `window`.
 *
 * StrictMode runs effect → cleanup → effect on mount. `history.back()` is
 * async, so a cleanup that called it directly would pop the SECOND run's
 * fresh entry and close the sheet the moment it opened. The pop is deferred
 * a tick instead, and a re-run for the same id cancels it and adopts the
 * entry that's already there — one push, one entry.
 */
interface Marker {
  sheet: string;
  t: number;
}

let pendingPop: { marker: Marker; timer: number } | null = null;

function currentMarker(): Marker | null {
  const s = window.history.state as Partial<Marker> | null;
  return s && typeof s.sheet === "string" && typeof s.t === "number" ? { sheet: s.sheet, t: s.t } : null;
}

function isMarker(m: Marker): boolean {
  const c = currentMarker();
  return c !== null && c.sheet === m.sheet && c.t === m.t;
}

export function useBackToClose(id: string, onClose: () => void, open = true): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    let marker: Marker;
    if (pendingPop && pendingPop.marker.sheet === id && isMarker(pendingPop.marker)) {
      window.clearTimeout(pendingPop.timer);
      marker = pendingPop.marker;
      pendingPop = null;
    } else {
      marker = { sheet: id, t: Date.now() };
      // Keep Next's own keys (__NA, the tree) on the entry: the App Router
      // reloads the page on a popstate to an entry it doesn't recognise,
      // which Back-then-Forward would otherwise hit.
      const base = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.pushState({ ...base, ...marker }, "");
    }
    let popped = false;
    const onPop = () => {
      // Every open sheet hears every popstate (CategorySheet stacks over
      // CardDetailModal); only the one whose entry just left the top closes.
      if (isMarker(marker)) return;
      popped = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (popped || !isMarker(marker)) return;
      const timer = window.setTimeout(() => {
        pendingPop = null;
        if (isMarker(marker)) window.history.back();
      }, 0);
      pendingPop = { marker, timer };
    };
  }, [id, open]);
}
