import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import { SITE_URL } from "@/lib/siteUrl";
import "./globals.css";

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
    "Scan your Pokémon and Magic: The Gathering cards, get real market prices, and turn a whole binder into eBay listings in minutes.",
  openGraph: {
    title: "CardFlip — Scan. Price. List.",
    description:
      "Scan your Pokémon and Magic: The Gathering cards, get real market prices, and turn a whole binder into eBay listings in minutes.",
    type: "website",
  },
  // iOS ignores the manifest's display mode; these meta tags are what make
  // "Add to Home Screen" open full-screen there. Icons + manifest come from
  // app/icon.tsx, app/apple-icon.tsx, app/manifest.ts.
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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
