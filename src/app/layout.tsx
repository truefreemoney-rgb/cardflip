import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import { SITE_URL } from "@/lib/siteUrl";
import "./globals.css";
import Prefetch from "@/components/Prefetch";
import RefCapture from "@/components/RefCapture";
import JsonLd from "@/components/JsonLd";
import { siteGraph } from "@/lib/structuredData";
import { PLAN, PRO } from "@/components/PlanCard";

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
  description:
    "Scan your Pokémon cards, get real market prices, and turn a whole binder into eBay listings in minutes.",
  // Every public page overrides this with its own path; the private ones
  // are noindex anyway. Keeps ?ref= and tracking variants from splitting
  // the landing page in search results.
  alternates: { canonical: "/" },
  openGraph: {
    title: "CardFlip — Scan. Price. List.",
    description:
      "Scan your Pokémon cards, get real market prices, and turn a whole binder into eBay listings in minutes.",
    type: "website",
    siteName: "CardFlip",
    locale: "en_US",
    url: "/",
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
        <RefCapture />
        <JsonLd
          data={siteGraph([
            { name: "CardFlip", priceUsd: Number(PLAN.price.replace("$", "")), scans: PLAN.scans },
            { name: "CardFlip Pro", priceUsd: Number(PRO.price.replace("$", "")), scans: PRO.scans },
          ])}
        />
      </body>
    </html>
  );
}
