import type { Metadata } from "next";

export const metadata: Metadata = { title: "Scanner" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
