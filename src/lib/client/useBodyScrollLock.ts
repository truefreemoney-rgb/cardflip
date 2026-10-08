"use client";

import { useEffect } from "react";

/**
 * Lock the page behind a modal/sheet — the one way that holds on iOS Safari.
 *
 * `body { overflow: hidden }` alone does nothing on iOS: the page still
 * rubber-bands behind a sheet and a finger on the backdrop scrolls the ledger
 * (mobile QA 09-06, five modals). The fix that works everywhere is pinning
 * the body: position fixed at the current scroll offset, full width, then
 * restoring the offset on unlock so the page doesn't jump to the top.
 *
 * Ref-counted, because sheets stack (CategorySheet over CardDetailModal): the
 * body unlocks when the LAST one closes, and restores the styles as they were
 * before the first.
 */
let locks = 0;
let saved: { position: string; top: string; left: string; right: string; width: string; overflow: string; scrollY: number } | null = null;

/** The offset the last unlock put the page back to, and when (10-08, see pinScroll). */
let restored: { y: number; at: number } | null = null;

/**
 * The offset the page was just put back to, if an unlock happened within the
 * last second; null otherwise. useBackToClose reads this instead of
 * window.scrollY: on iOS the page reports 0 for a beat after the body is
 * un-pinned, and a close that trusted that beat held the page at the top
 * (Chris 10-08).
 */
export function justRestoredScrollY(): number | null {
  return restored && Date.now() - restored.at < 1000 ? restored.y : null;
}

/**
 * Put the page at `y` now and again over the next 300 ms, with the browser's
 * own scroll restoration switched off meanwhile. Safari re-applies a stale
 * saved position after a history pop (the sheet's back-to-close entry), and
 * un-pinning the body lands a frame late on iOS; both are covered by this.
 */
export function pinScroll(y: number): void {
  const prev = window.history.scrollRestoration;
  try {
    window.history.scrollRestoration = "manual";
  } catch {
    // Older engines: the scrollTo calls still do the work.
  }
  const put = () => window.scrollTo(0, y);
  put();
  window.requestAnimationFrame(put);
  window.setTimeout(put, 50);
  window.setTimeout(put, 150);
  window.setTimeout(() => {
    put();
    try {
      window.history.scrollRestoration = prev;
    } catch {
      // nothing to restore
    }
  }, 300);
}

function lock() {
  if (typeof document === "undefined") return;
  if (locks++ > 0) return;
  const body = document.body;
  const { style } = body;
  saved = { position: style.position, top: style.top, left: style.left, right: style.right, width: style.width, overflow: style.overflow, scrollY: window.scrollY };
  style.position = "fixed";
  style.top = `-${saved.scrollY}px`;
  style.left = "0";
  style.right = "0";
  style.width = "100%";
  style.overflow = "hidden";
}

function unlock() {
  if (typeof document === "undefined") return;
  if (locks === 0) return;
  if (--locks > 0) return;
  const { style } = document.body;
  const s = saved;
  saved = null;
  if (!s) return;
  style.position = s.position;
  style.top = s.top;
  style.left = s.left;
  style.right = s.right;
  style.width = s.width;
  style.overflow = s.overflow;
  restored = { y: s.scrollY, at: Date.now() };
  pinScroll(s.scrollY);
}

/** Lock while mounted (or while `active`). */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
