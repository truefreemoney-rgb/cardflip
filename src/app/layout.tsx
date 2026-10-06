import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import { SITE_URL } from "@/lib/siteUrl";
import "./globals.css";
import Prefetch from "@/components/Prefetch";
import AttributionCapture from "@/components/AttributionCapture";
import VisitPing from "@/components/VisitPing";
import DeferredAnalytics from "@/components/DeferredAnalytics";
import { DESCRIPTION } from "@/lib/structuredData";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CardFlip — Scan. Price. List.",
    template: "%s · CardFlip",
  },
  description: DESCRIPTION,
  // No canonical here on purpose: every public page sets its own through
  // lib/seo.ts pageMetadata (which keeps ?ref= and tracking variants from
  // splitting it in search results), and a private page must never point at
  // the landing page.
  openGraph: {
    title: "CardFlip — Scan. Price. List.",
    description: DESCRIPTION,
    type: "website",
    siteName: "CardFlip",
    locale: "en_US",
  },
  // Search engine ownership proofs: paste the token each console hands out
  // into the Vercel env (GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION)
  // and redeploy — nothing renders while they are unset.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
  // iOS ignores the manifest's display mode; these meta tags are what make
  // "Add to Home Screen" open full-screen there. Icons + manifest come from
  // app/icon.png, app/apple-icon.png, public/icon-maskable.png (all from public/brand/cardflip-icon.png), app/manifest.ts.
  appleWebApp: {
    capable: true,
    title: "CardFlip",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b11",
  colorScheme: "dark",
  // Lets the app paint under the iOS notch/home bar; headers pad with
  // env(safe-area-inset-*) so content stays clear of them.
  viewportFit: "cover",
  // Android Chrome ≥108 keeps the layout viewport under the keyboard by
  // default, so fixed/sticky bottom bars (publish bar, help composer, toasts)
  // hid behind it (mobile QA 09-06). iOS ignores this.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
        <Prefetch />
        <AttributionCapture />
        <VisitPing />
        <DeferredAnalytics />
      </body>
    </html>
  );
}
