"use client";

import { useEffect, useRef } from "react";
import { justRestoredScrollY, pinScroll } from "@/lib/client/useBodyScrollLock";

/**
 * Android's back button (and the iOS back-swipe) closes the SHEET, not the
 * app. On open push a history entry and a matching entry onto a module-level
 * STACK of open sheets; a popstate closes the TOP stack entry only. A
 * programmatic close (X, backdrop, Esc, Done) releases its own entry and pops
 * history only if that entry is still on top — and that pop is marked, so the
 * popstate it causes closes nothing.
 *
 * 10-22: who was popped comes from the stack, never from history.state.
 * Next's router (and our own replaceState calls) overwrite state without any
 * marker of ours, and the old marker compare then decided the camera had been
 * popped when "This copy" said Done: camera closed, category sheet, listing
 * page (Chris, 10-19). Next can't overwrite the stack.
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
export interface BackEntry {
  id: string;
  /** Page the entry was pushed on: a pop after the page changed would walk back out of the new page. */
  href: string;
  close: () => void;
}

/**
 * The pure part, split out so scripts/test-back-stack.mjs can drive it with
 * no browser. `stack` is bottom → top; `ignore` holds one token per
 * history.back() we issued, so the popstate it causes isn't read as the
 * user's Back.
 */
export function createBackStack() {
  const stack: BackEntry[] = [];
  const ignore: number[] = [];
  let seq = 0;
  return {
    stack,
    push(entry: BackEntry): BackEntry {
      stack.push(entry);
      return entry;
    },
    has: (entry: BackEntry) => stack.includes(entry),
    /** A popstate arrived: the entry to close, or null (our own pop, or nothing open). */
    onPop(): BackEntry | null {
      if (ignore.length > 0) {
        ignore.shift();
        return null;
      }
      return stack.pop() ?? null;
    },
    /**
     * A programmatic close. Returns a token when the caller must call
     * history.back() (entry was on top and `canBack`), else null; the entry
     * is out of the stack either way.
     */
    release(entry: BackEntry, canBack = true): number | null {
      const i = stack.indexOf(entry);
      if (i < 0) return null;
      const onTop = i === stack.length - 1;
      stack.splice(i, 1);
      if (!onTop || !canBack) return null;
      const token = ++seq;
      ignore.push(token);
      return token;
    },
    /** history.back() never answered: stop waiting for it. */
    forget(token: number) {
      const i = ignore.indexOf(token);
      if (i >= 0) ignore.splice(i, 1);
    },
  };
}

const back = createBackStack();
let listening = false;
let pendingPop: { entry: BackEntry; timer: number } | null = null;

export function useBackToClose(id: string, onClose: () => void, open = true): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (!listening) {
      listening = true;
      window.addEventListener("popstate", () => back.onPop()?.close());
    }
    let entry: BackEntry;
    if (pendingPop && pendingPop.entry.id === id && back.has(pendingPop.entry)) {
      window.clearTimeout(pendingPop.timer);
      entry = pendingPop.entry;
      pendingPop = null;
    } else {
      entry = back.push({ id, href: window.location.href, close: () => {} });
      // Keep Next's own keys (__NA, the tree) on the entry: the App Router
      // reloads the page on a popstate to an entry it doesn't recognise,
      // which Back-then-Forward would otherwise hit.
      const base = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.pushState({ ...base, sheet: id }, "");
    }
    // An adopted entry points at this run's ref, not the cleaned-up one's.
    entry.close = () => onCloseRef.current();
    const mine = entry;
    return () => {
      if (!back.has(mine)) return; // popped by Back already: nothing to undo
      const timer = window.setTimeout(() => {
        pendingPop = null;
        const token = back.release(mine, window.location.href === mine.href);
        if (token === null) return;
        // The pop is a history traversal, and Safari restores the scroll
        // position it saved for the earlier entry on it. That entry was left
        // while the body was pinned for the sheet (useBodyScrollLock), so the
        // saved position is wrong: the home page jumped to the bottom on X
        // (Chris 10-08). Put the page back where the unlock left it.
        // Safari applies its restore after the popstate on a touch-driven close
        // (the handle drag still jumped after the first fix, Chris 10-08), so
        // restoration is switched off for the traversal and the offset is
        // re-applied a few times over the next beats.
        // The offset comes from the scroll lock's own record: a fresh
        // window.scrollY read here is 0 for a beat on iOS (third round, 10-08:
        // "shoots me to the top").
        const y = justRestoredScrollY() ?? window.scrollY;
        window.addEventListener("popstate", () => pinScroll(y), { once: true });
        window.history.back();
        window.setTimeout(() => back.forget(token), 1500);
      }, 0);
      pendingPop = { entry: mine, timer };
    };
  }, [id, open]);
}
