import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a CardFlip account: scan your cards, see real market prices, and list them on eBay in minutes.",
  alternates: { canonical: "/signup" },
  openGraph: { url: "/signup", title: "Sign up · CardFlip" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
