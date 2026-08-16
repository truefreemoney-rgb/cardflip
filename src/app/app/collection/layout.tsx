import type { Metadata } from "next";

export const metadata: Metadata = { title: "My cards" };

export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
