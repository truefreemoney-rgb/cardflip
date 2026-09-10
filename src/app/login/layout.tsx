import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to CardFlip to scan, price and list your cards.",
  alternates: { canonical: "/login" },
  openGraph: { url: "/login", title: "Log in · CardFlip" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
