"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CatalogSearch from "@/components/CatalogSearch";
import { gameFromSlug } from "@/lib/cardPages";
import Logo from "@/components/Logo";
import { fetchCurrentUser, logout, type SessionUser } from "@/lib/client/auth";
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

  const link = "whitespace-nowrap px-2.5 py-2 text-sm text-zinc-400 transition hover:text-white";

  return (
    <>
    {bottomNav && <PublicBottomNav />}
    <header className="sticky top-0 z-50 bg-background/85 backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent">
      <nav className="mx-auto flex w-full max-w-6xl flex-col items-center gap-1 px-4 py-2 sm:h-14 sm:flex-row sm:justify-between sm:gap-0 sm:px-6 sm:py-0">
        <Logo />
        {/* Phones (Chris 10-14: "the top nav is missing How it works, Features and card prices"): every link shows and the
            row wraps into two lines (search + the three pages, then Pricing / Log In / Get Started). One row from sm up. */}
        <div className="flex flex-wrap items-center justify-center gap-1 sm:flex-nowrap sm:gap-2">
          {/* Search first (Chris 10-08: left of How It Works, not in the middle of the links). */}
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
          </button>
          <Link href="/#how-it-works" className={link}>
            How It Works
          </Link>
          <Link href="/features" className={link}>
            Features
          </Link>
          <Link href="/cards" className={link}>
            Card Prices
          </Link>
          <Link href="/pricing" className={link}>
            Pricing
          </Link>
          {user || (!known && hinted) ? (
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
              <Link href="/login" className={`${link} ${known ? "" : "invisible"}`}>
                Log In
              </Link>
              <Link
                href="/signup"
                className={`ml-1 whitespace-nowrap rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 ${known ? "" : "invisible"}`}
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
    </>
  );
}
