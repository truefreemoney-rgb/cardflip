"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { visitorCountry } from "@/lib/client/geo";

/**
 * Google Analytics 4 (Chris 09-25). Renders nothing until
 * NEXT_PUBLIC_GA_ID (G-XXXXXXXXXX, from the board row) exists on Vercel, and
 * never on /admin. IP anonymisation is GA4's default; the privacy page names
 * Google Analytics under "What we collect".
 *
 * Consent (Chris 09-30): visitors in the UK and Ireland get an Accept / Reject
 * bar and GA does not load until they accept; everyone else is unchanged.
 * The country comes from /api/geo (once per tab session), never a proxy
 * cookie, so cached pages stay cached. The choice lives in cf_consent.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const CONSENT_COOKIE = "cf_consent";
const CONSENT_COUNTRIES = new Set(["GB", "IE"]);

function readConsent(): "yes" | "no" | null {
  const m = document.cookie.match(/(?:^|;\s*)cf_consent=(yes|no)/);
  return m ? (m[1] as "yes" | "no") : null;
}

function saveConsent(v: "yes" | "no") {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${v}; Max-Age=${365 * 24 * 3600}; Path=/; SameSite=Lax${secure}`;
}

export default function GoogleAnalytics() {
  const pathname = usePathname();
  // "load" = GA on; "ask" = show the bar; "off" = rejected; null = still deciding.
  const [mode, setMode] = useState<"load" | "ask" | "off" | null>(null);

  useEffect(() => {
    if (!GA_ID) return;
    let alive = true;
    (async () => {
      const prior = readConsent();
      // Only ask /api/geo when no choice is stored yet.
      const country = prior ? null : await visitorCountry();
      const next = prior ? (prior === "yes" ? "load" : "off") : country && CONSENT_COUNTRIES.has(country) ? "ask" : "load";
      if (alive) setMode(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!GA_ID || !pathname || pathname.startsWith("/admin")) return null;

  if (mode === "ask") {
    return (
      <div
        role="dialog"
        aria-label="Cookie choice"
        className="fixed inset-x-0 bottom-0 z-[100] border-t border-edge bg-[#0b0d13] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-xs text-zinc-300">
            CardFlip uses Google Analytics cookies to see which pages people use.{" "}
            <a href="/privacy" className="text-brand-300 underline">Privacy</a>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                saveConsent("no");
                setMode("off");
              }}
              className="flex-1 rounded-full border border-edge px-5 py-2 text-sm font-semibold text-white sm:flex-none"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => {
                saveConsent("yes");
                setMode("load");
              }}
              className="flex-1 rounded-full border border-edge px-5 py-2 text-sm font-semibold text-white sm:flex-none"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode !== "load") return null;
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
      </Script>
    </>
  );
}
