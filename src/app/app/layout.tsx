import type { Metadata } from "next";
import Link from "next/link";
import SessionProvider from "@/components/SessionProvider";
import AppHeader from "@/components/AppHeader";
import SubscriptionGate from "@/components/SubscriptionGate";
import Toaster from "@/components/Toaster";

export const metadata: Metadata = { title: "Scanner" };

/**
 * The signed-in app carries the same legal surface as the marketing pages.
 * Paid-only since 09-04: SubscriptionGate walls every page but Account.
 *
 * The session is looked up once here (SessionProvider) and the header lives
 * here too, so switching tabs doesn't blank the page or re-ask /api/auth/me.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <AppHeader />
        <SubscriptionGate>{children}</SubscriptionGate>
      </div>
      <Toaster />
      <footer className="border-t border-white/5 px-6 py-4 text-center text-[11px] text-zinc-600">
        <nav className="inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link href="/terms" className="transition hover:text-zinc-300">
            Terms
          </Link>
          <Link href="/privacy" className="transition hover:text-zinc-300">
            Privacy
          </Link>
          <a
            href="mailto:support@cardflip.io"
            className="transition hover:text-zinc-300"
          >
            Contact
          </a>
          <span>Not affiliated with Nintendo, The Pokémon Company, Wizards of the Coast, or eBay Inc.</span>
        </nav>
      </footer>
    </SessionProvider>
  );
}
