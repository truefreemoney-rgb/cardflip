"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CatalogSearch from "@/components/CatalogSearch";
import { gameFromSlug } from "@/lib/cardPages";
import Logo from "@/components/Logo";
import { fetchCurrentUser, logout, type SessionUser } from "@/lib/client/auth";

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
export default function MarketingNav() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [searching, setSearching] = useState(false);
  // On /cards/{game}/... the search stays inside that game.
  const pathname = usePathname() ?? "";
  const pageGame = pathname.startsWith("/cards/") ? gameFromSlug(pathname.split("/")[2] ?? "") : null;

  useEffect(() => {
    let alive = true;
    fetchCurrentUser()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const link = "whitespace-nowrap px-2.5 py-2 text-sm text-zinc-400 transition hover:text-white";

  return (
    <header className="sticky top-0 z-50 bg-background/85 backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent">
      <nav className="mx-auto flex w-full max-w-6xl flex-col items-center gap-1 px-4 py-2 sm:h-14 sm:flex-row sm:justify-between sm:gap-0 sm:px-6 sm:py-0">
        <Logo />
          {/* Search first (Chris 10-08: left of How It Works, not in the middle of the links). */}
            Card Prices
          </Link>
          <button
            type="button"
            onClick={() => setSearching((v) => !v)}
            aria-label={searching ? "Close card search" : "Search cards"}
            aria-expanded={searching}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {searching ? <path d="M6 6l12 12M18 6L6 18" /> : <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>}
            </svg>
        <div className="flex items-center justify-center gap-1 sm:gap-2">
          <Link href="/#how-it-works" className={`${link} hidden sm:inline-block`}>
            How It Works
          </Link>
          <Link href="/features" className={`${link} hidden sm:inline-block`}>
            Features
          </Link>
          {/* Phones keep the short row (Pricing / Log In / Get Started); Card Prices is in the footer there. */}
          <Link href="/cards" className={`${link} hidden sm:inline-block`}>
          </button>
          <Link href="/pricing" className={link}>
            Pricing
          </Link>
          {user ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void logout().then(() => {
                    setUser(null);
                    window.location.reload();
                  });
                }}
                className={link}
              >
                Log out
              </button>
              <Link
                href="/app"
                className="ml-1 whitespace-nowrap rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
              >
                Open the App
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className={link}>
                Log In
              </Link>
              <Link
                href="/signup"
                className="ml-1 whitespace-nowrap rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </nav>
      {searching && (
        <div className="mx-auto w-full max-w-6xl px-4 pb-2 sm:px-6">
          <CatalogSearch variant="nav" game={pageGame ?? undefined} autoFocus onNavigate={() => setSearching(false)} />
        </div>
      )}
    </header>
  );
}
