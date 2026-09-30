"use client";

import { useEffect } from "react";
import { chooseTouch, parseTouch, touchFromPage, type Touch } from "@/lib/attribution";

/**
 * Remembers where this browser first came from (a tagged social link, a
 * search, another site, or just the address bar) so signup can say which post
 * brought the person (lib/attribution.ts). localStorage only: no cookie,
 * nothing third-party, sent to us once, at signup. First touch wins for 30
 * days; a stored "direct" gives way to a real source. Like RefCapture,
 * storage being blocked just means the signup carries no source.
 */
const KEY = "cardflip.touch";

export function readTouch(): Touch | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseTouch(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export default function AttributionCapture() {
  useEffect(() => {
    try {
      // The console is ours, not a landing page.
      if (window.location.pathname.startsWith("/admin")) return;
      const fresh = touchFromPage({ search: window.location.search, referrer: document.referrer, pathname: window.location.pathname });
      const next = chooseTouch(readTouch(), fresh);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode / storage blocked — the signup just won't carry a source.
    }
  }, []);
  return null;
}
