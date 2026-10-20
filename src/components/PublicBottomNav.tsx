"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import BottomTabBar from "./BottomTabBar";

/**
 * The app's phone tab bar on the public card pages for a signed-in seller (Chris, 10-19 phone
 * checks #5): one thumb back to the scanner / inventory from any /cards page. Rendered through a
 * portal because MarketingNav's backdrop-blur header is a containing block for fixed children.
 * Publishes --bottom-nav-h on <html> so the card page's sticky price bar and the footer lift
 * above it (same contract as the app layout).
 */
export default function PublicBottomNav() {
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(max-width: 767.98px)");
    const apply = () => root.style.setProperty("--bottom-nav-h", mq.matches ? "calc(3.5rem + env(safe-area-inset-bottom))" : "0px");
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      root.style.removeProperty("--bottom-nav-h");
    };
  }, []);
  return createPortal(<BottomTabBar />, document.body);
}
