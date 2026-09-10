import type { Metadata } from "next";

export const metadata: Metadata = { title: "Connect eBay", robots: { index: false, follow: false } };

export default function ConnectEbayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
