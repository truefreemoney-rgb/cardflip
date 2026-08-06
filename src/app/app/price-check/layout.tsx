import type { Metadata } from "next";

export const metadata: Metadata = { title: "Price Check" };

export default function PriceCheckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
