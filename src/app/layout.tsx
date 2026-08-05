import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CardFlip — Scan. Price. List.",
    template: "%s · CardFlip",
  },
  description:
    "Scan your Pokémon cards, get real market prices, and turn a whole binder into eBay listings in minutes.",
  openGraph: {
    title: "CardFlip — Scan. Price. List.",
    description:
      "Scan your Pokémon cards, get real market prices, and turn a whole binder into eBay listings in minutes.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#08090d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
