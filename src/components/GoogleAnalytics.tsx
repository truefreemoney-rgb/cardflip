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
/**
 * TikTok Pixel (10-04, the first paid ad test). Rides on the same consent
 * gate and the same /admin exclusion as GA4; absent until the id exists on
 * Vercel. Conversion events are sent through lib/client/pixel.ts.
 */
const TIKTOK_PIXEL_ID = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;
/**
 * Google Ads (10-06, signup plan): the same gtag.js as GA4, configured for the
 * AW- account too. Absent until NEXT_PUBLIC_GOOGLE_ADS_ID exists on Vercel.
 * Conversions are sent through lib/client/pixel.ts.
 */
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const GTAG_ID = GA_ID || ADS_ID;
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
    if (!GTAG_ID && !TIKTOK_PIXEL_ID) return;
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

  if ((!GTAG_ID && !TIKTOK_PIXEL_ID) || !pathname || pathname.startsWith("/admin")) return null;

  if (mode === "ask") {
    return (
      <div
        role="dialog"
        aria-label="Cookie choice"
        className="fixed inset-x-0 bottom-0 z-[100] border-t border-edge bg-[#0b0d13] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-xs text-zinc-300">
            CardFlip uses analytics cookies to see which pages people use and whether our ads work.{" "}
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
      {GTAG_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GTAG_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${[GA_ID, ADS_ID].filter(Boolean).map((id) => `gtag('config','${id}');`).join("")}`}
          </Script>
        </>
      )}
      {TIKTOK_PIXEL_ID && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var s=document.createElement("script");s.type="text/javascript",s.async=!0,s.src=r+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(s,a)};ttq.load('${TIKTOK_PIXEL_ID}');ttq.page();}(window,document,'ttq');`}
        </Script>
      )}
    </>
  );
}
