"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CatalogSearch from "@/components/CatalogSearch";
import { gameFromSlug } from "@/lib/cardPages";
import Logo from "@/components/Logo";
import { fetchCurrentUser, logout, type SessionUser } from "@/lib/client/auth";
import { TAP_4 } from "@/lib/tap";
import PublicBottomNav from "./PublicBottomNav";

/**
 * The public-page nav. It checks for a live session so a signed-in seller
 * sees their own name, a Log out, and a way into the app — before 08-27 it
 * always showed the logged-out Log in / Get started pair, which read as
 * "the homepage logged me out" and sent sellers back through the login form
 * on a session that was still perfectly valid. Client-side on purpose:
 * reading cookies() here would drag every marketing page from static to
 * per-request rendering. Until the check answers, the logged-out pair shows
 * — wrong only for the signed-in minority, and only for a moment.
 *
 * 09-04 (Chris: "I still don't like how it looks"): the floating foil
 * capsule is gone. This is the app's own header chrome — flat, full-width,
 * sticky, holo hairline underneath — so the marketing site and the product
 * read as one thing. Links sit right, in one row, one weight.
 *
 * Phones (Chris, 09-10, issue #19): the logo takes its own row above the
 * links. The 09-09 wordmark logo is 170px wide at 32px tall, and with
 * Pricing / Log In / Get Started beside it the row needed ~420px on a
 * 343px-wide phone line. Both rows are centered — the same masthead-over-
 * pill shape as the app header's phone layout. From sm it is the one row.
 */
const NAV_HINT = "cf_nav_signed_in";
const subscribeNever = () => () => {};
function readHint(): boolean {
  try {
    return window.localStorage.getItem(NAV_HINT) === "1";
  } catch {
    return false; // private mode
  }
}

export default function MarketingNav() {
  const [user, setUser] = useState<SessionUser | null>(null);
  // No flash of "Log In" on a signed-in phone (Chris 10-08): until the session answers, the two account slots stay
  // invisible unless the last visit left a signed-in hint, in which case the signed-in pair shows at once.
  // The hint is read AFTER mount (10-12): reading localStorage while rendering made the browser's first paint
  // ("Log out") differ from the server's ("Log In"), a hydration error on every marketing page for signed-in visitors.
  const [known, setKnown] = useState(false);
  const hinted = useSyncExternalStore(subscribeNever, readHint, () => false);
  const [searching, setSearching] = useState(false);
  // On /cards/{game}/... the search stays inside that game.
  const pathname = usePathname() ?? "";
  const pageGame = pathname.startsWith("/cards/") ? gameFromSlug(pathname.split("/")[2] ?? "") : null;
  // Signed in on a /cards page: the app phone tab bar shows (10-19 phone checks #5). `user` only, never the hint:
  // a stale hint would pin a bar whose every tab bounces to /login.
  const bottomNav = Boolean(user) && pathname.startsWith("/cards");

  useEffect(() => {
    let alive = true;
    fetchCurrentUser()
      .then((u) => {
        if (!alive) return;
        setUser(u);
        setKnown(true);
        try {
          window.localStorage.setItem(NAV_HINT, u ? "1" : "0");
        } catch {
          /* private mode */
        }
      })
      .catch(() => {
        if (alive) setKnown(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // TAP_4 grows each 36px link and button to a 44px tap target without changing its look (review 10-19 #24).
  const link = `${TAP_4} whitespace-nowrap px-2.5 py-2 text-sm text-zinc-400 transition hover:text-white`;

  // Log In / Get Started (or Log out / Open the App). Rendered twice: beside the logo on phones, at the row's end from sm.
  const account = (where: string) =>
    user || (!known && hinted) ? (
      <div className={`items-center ${where}`}>
        <button
          type="button"
          onClick={() => {
            // A failed call still reloads: the page then shows whether the session really ended (review 10-19 marketing #20).
            void logout()
              .then(() => setUser(null))
              .catch(() => undefined)
              .finally(() => window.location.reload());
          }}
          className={link}
        >
          Log out
        </button>
        <Link
          href="/app"
          className={`${TAP_4} ml-1 whitespace-nowrap rounded-full bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 min-[400px]:px-4`}
        >
          Open the App
        </Link>
      </div>
    ) : (
      <div className={`items-center ${where}`}>
        <Link href="/login" className={`${link} ${known ? "" : "invisible"}`}>
          Log In
        </Link>
        <Link
          href="/signup"
          className={`${TAP_4} ml-1 whitespace-nowrap rounded-full bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 min-[400px]:px-4 ${known ? "" : "invisible"}`}
        >
          Get Started
        </Link>
      </div>
    );

  return (
    <>
    {bottomNav && <PublicBottomNav />}
    <header className="sticky top-0 z-50 bg-background/85 backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent">
      <nav className="mx-auto flex w-full max-w-6xl flex-col items-center gap-0.5 px-3 py-1.5 min-[400px]:px-4 sm:h-14 sm:flex-row sm:justify-between sm:gap-0 sm:px-6 sm:py-0">
        {/* Phones (Chris 10-28, "i hate how pricing adds an extra row"): two rows, not three. Row 1 = a smaller logo
            with the account pair beside it; row 2 = search + the pages. "How It Works" left the nav (same flow as
            Features; the home page section stays). One row from sm up. */}
        <div className="flex w-full items-center justify-between sm:w-auto">
          <Logo size="nav" />
          {account("flex sm:hidden")}
        </div>
        <div className="flex items-center justify-center gap-1 sm:gap-2">
          {/* Search first (Chris 10-08: left of How It Works, not in the middle of the links). */}
          <button
            type="button"
            onClick={() => setSearching((v) => !v)}
            aria-label={searching ? "Close card search" : "Search cards"}
            aria-expanded={searching}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition before:absolute before:-inset-1 before:content-[''] hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {searching ? <path d="M6 6l12 12M18 6L6 18" /> : <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>}
            </svg>
          </button>
          <Link href="/features" className={link}>
            Features
          </Link>
          <Link href="/cards" className={link}>
            Card Prices
          </Link>
          <Link href="/pricing" className={link}>
            Pricing
          </Link>
          {account("hidden sm:flex")}
        </div>
      </nav>
      {searching && (
        <div className="mx-auto w-full max-w-6xl px-4 pb-2 sm:px-6">
          <CatalogSearch variant="nav" game={pageGame ?? undefined} autoFocus onNavigate={() => setSearching(false)} />
        </div>
      )}
    </header>
    </>
  );
}
