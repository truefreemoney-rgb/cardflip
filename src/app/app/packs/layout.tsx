import type { Metadata } from "next";

export const metadata: Metadata = { title: "Packs" };

export default function PacksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
