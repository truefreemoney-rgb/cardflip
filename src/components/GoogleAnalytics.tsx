"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { visitorCountry } from "@/lib/client/geo";
import { tagsOff } from "@/lib/client/pixel";

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
/**
 * X Pixel (10-26, the first X ad test): the same consent gate and /admin + /app
 * rules as TikTok; absent until NEXT_PUBLIC_X_PIXEL_ID exists on Vercel.
 * Conversions are sent through lib/client/pixel.ts. X's automatic extras
 * (button clicks, a 10 s dwell ping, form and dataLayer matching) are switched
 * off: X has no pause like TikTok's holdConsent, so a tab that moved into /app
 * would keep sending them. What X gets is the landing page view and our events.
 */
const X_PIXEL_ID = process.env.NEXT_PUBLIC_X_PIXEL_ID;
const X_OFF = ["autoConfig", "autoDwellTracking", "autoAdvancedMatching", "dataLayerTracking"];
/**
 * Meta Pixel (10-27, the first Instagram ad test): the same consent gate and
 * /admin + /app rules as X; absent until NEXT_PUBLIC_META_PIXEL_ID exists on
 * Vercel. Conversions are sent through lib/client/pixel.ts. autoConfig off =
 * no automatic button-click or page-metadata events; automatic advanced
 * matching (email scraping) is off on the dataset in Events Manager. While a
 * tab is inside /app the pixel is paused with fbq('consent','revoke').
 */
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const ANY_TAG = GTAG_ID || TIKTOK_PIXEL_ID || X_PIXEL_ID || META_PIXEL_ID;
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
    if (!ANY_TAG) return;
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

  // Inside the signed-in app (/app) nothing measures (privacy page: "on the public pages, not inside your account";
  // found loading on /app/collection 10-18). No ad conversion fires there (signup and /scan are public). A tab that
  // came from a public page already has the tags running: they are paused while in /app, resumed outside it.
  // One exception (10-27): the purchase thank-you page, so a sale reaches the ad sites (lib/client/pixel.ts tagsOff).
  const inApp = tagsOff(pathname);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown> & { ttq?: { holdConsent?: () => void; grantConsent?: () => void }; fbq?: (...args: unknown[]) => void };
    for (const id of [GA_ID, ADS_ID]) if (id) w[`ga-disable-${id}`] = inApp;
    try {
      if (inApp) w.ttq?.holdConsent?.();
      else if (mode === "load") w.ttq?.grantConsent?.();
    } catch {
      // Measurement never breaks the page.
    }
    try {
      if (inApp) w.fbq?.("consent", "revoke");
      else if (mode === "load") w.fbq?.("consent", "grant");
    } catch {
      // Measurement never breaks the page.
    }
  }, [inApp, mode]);

  if (!ANY_TAG || !pathname || pathname.startsWith("/admin")) return null;

  if (mode === "ask") {
    // On /app phones the bar sits ON the bottom tab bar (BottomTabBar: h-14 + home-bar inset), never over it,
    // so the tabs stay tappable before a choice (audit 10-16). Rendered outside app/app/layout, so it cannot read --bottom-nav-h.
    const aboveTabs = pathname === "/app" || pathname.startsWith("/app/");
    return (
      <div
        role="dialog"
        aria-label="Cookie choice"
        className={`fixed inset-x-0 bottom-0 z-[100] border-t border-edge bg-[#0b0d13] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black ${aboveTabs ? "max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:pb-3" : ""}`}
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

  if (mode !== "load" || inApp) return null;
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
      {X_PIXEL_ID && (
        <Script id="x-pixel" strategy="afterInteractive">
          {`!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');${X_OFF.map((k) => `twq('set','${k}','false','${X_PIXEL_ID}');`).join("")}twq('config','${X_PIXEL_ID}');`}
        </Script>
      )}
      {META_PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('set','autoConfig',false,'${META_PIXEL_ID}');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}
    </>
  );
}
