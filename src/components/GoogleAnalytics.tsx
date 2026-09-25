"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

/**
 * Google Analytics 4 (Chris 09-25). Renders nothing until
 * NEXT_PUBLIC_GA_ID (G-XXXXXXXXXX, from the board row) exists on Vercel, and
 * never on /admin. IP anonymisation is GA4's default; the privacy page names
 * Google Analytics under "What we collect".
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export default function GoogleAnalytics() {
  const pathname = usePathname();
  if (!GA_ID || !pathname || pathname.startsWith("/admin")) return null;
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
