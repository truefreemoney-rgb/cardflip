"use client";

import { useEffect } from "react";
import { chooseTouch, parseTouch, touchFromPage, type Touch } from "@/lib/attribution";

/**
 * Remembers, in this browser, how the person got here. Two things, both
 * localStorage only (no cookie, nothing third-party), both read back once, at
 * signup:
 *
 * - Invite a friend: a share link is cardflip.io/?ref=CODE. Whatever page it
 *   lands on, remember the code so the signup form can send it along. A stale
 *   code is harmless (the server ignores codes it doesn't know).
 * - First touch (lib/attribution.ts): a tagged social link, a search, another
 *   site, or just the address bar, so signup can say which post brought the
 *   person. First touch wins for 30 days; a stored "direct" gives way to a
 *   real source.
 *
 * Storage being blocked just means the signup carries no code or source.
 */
const REF_KEY = "cardflip.ref";
const TOUCH_KEY = "cardflip.touch";

export function readReferralCode(): string | null {
  try {
    return localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function readTouch(): Touch | null {
  try {
    const raw = localStorage.getItem(TOUCH_KEY);
    return raw ? parseTouch(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export default function AttributionCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) localStorage.setItem(REF_KEY, ref.toUpperCase());
    } catch {
      // Private mode / storage blocked — the signup just won't carry a code.
    }
    try {
      // The console is ours, not a landing page.
      if (window.location.pathname.startsWith("/admin")) return;
      const fresh = touchFromPage({ search: window.location.search, referrer: document.referrer, pathname: window.location.pathname, userAgent: navigator.userAgent });
      const next = chooseTouch(readTouch(), fresh);
      localStorage.setItem(TOUCH_KEY, JSON.stringify(next));
    } catch {
      // Private mode / storage blocked — the signup just won't carry a source.
    }
  }, []);
  return null;
}
