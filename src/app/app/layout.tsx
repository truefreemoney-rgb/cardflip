import Link from "next/link";
import SessionProvider from "@/components/SessionProvider";
import AppHeader from "@/components/AppHeader";
import BottomTabBar from "@/components/BottomTabBar";
import SubscriptionGate from "@/components/SubscriptionGate";
import Toaster from "@/components/Toaster";
import TourOverlay from "@/components/TourOverlay";
import { PendingWatch } from "@/components/WatchPrice";
import { NOT_AFFILIATED } from "@/lib/games";
import { PRIVATE_META } from "@/lib/pageMeta";

export const metadata = PRIVATE_META.app;

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
      {/* --bottom-nav-h = the phone tab bar's height (unset from md up). The footer pads by it;
          Toaster and any bottom-fixed element should offset by var(--bottom-nav-h, 0px). */}
      <div className="max-md:[--bottom-nav-h:calc(3.5rem+env(safe-area-inset-bottom))]">
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <AppHeader />
        <SubscriptionGate>{children}</SubscriptionGate>
        <TourOverlay />
        <PendingWatch />
      </div>
      <Toaster />
      <BottomTabBar />
      <footer className="border-t border-white/5 px-6 pt-4 pb-[calc(1rem+var(--bottom-nav-h,0px))] text-center text-[11px] text-zinc-600">
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
          <span>{NOT_AFFILIATED}</span>
        </nav>
      </footer>
      </div>
    </SessionProvider>
  );
}
