"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
 */
export default function MarketingNav() {
  const [user, setUser] = useState<SessionUser | null>(null);

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

  return (
    <nav className="sticky top-4 z-50 px-4">
      <div className="foil-edge mx-auto flex w-full max-w-4xl items-center justify-between rounded-full py-2 pl-4 pr-2 shadow-xl shadow-black/40 backdrop-blur-md [--foil-fill:rgba(12,14,20,0.82)]">
        <Logo />
        {/* Section links (Chris, 09-04: the bar was empty). Anchors resolve on
            the landing page; from anywhere else they navigate there. */}
        <div className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
          <Link href="/#how-it-works" className="transition hover:text-white">
            How it works
          </Link>
          <Link href="/pricing" className="transition hover:text-white">
            Pricing
          </Link>
          <Link href="/help" className="transition hover:text-white">
            Help
          </Link>
        </div>
        <div className="flex items-center gap-2 text-sm sm:gap-5">
          <Link href="/pricing" className="px-2 py-2 text-zinc-300 transition hover:text-white md:hidden">
            Pricing
          </Link>
          {/* No admin link here: the dashboard is operator-only (and gated),
              and advertising it on the public nav reads as unfinished. It's
              reachable at /admin and linked from the app for admins. */}
          {user ? (
            <>
              {/* The identity is the "you're logged in" signal (Chris,
                  08-27) — a green dot plus the account's own name, not a
                  generic badge. Hidden on the tightest screens; the Log
                  out + app buttons still tell the story there. */}
              <span className="hidden items-center gap-2 text-zinc-300 sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                {user.name.split(" ")[0]}
              </span>
              <button
                type="button"
                onClick={() => {
                  void logout().then(() => {
                    setUser(null);
                    window.location.reload();
                  });
                }}
                className="px-2 py-2 text-zinc-400 transition hover:text-white sm:px-0"
              >
                Log out
              </button>
              <Link
                href="/app"
                className="sheen rounded-full bg-white px-4 py-2 font-medium text-zinc-900 transition hover:bg-zinc-200"
              >
                Open the app
              </Link>
            </>
          ) : (
            <>
              {/* Visible at every width — on a phone this is the only way back
                  in for a returning seller (was sm:block, i.e. missing on mobile). */}
              <Link
                href="/login"
                className="px-2 py-2 text-zinc-300 transition hover:text-white sm:px-0"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="sheen rounded-full bg-white px-4 py-2 font-medium text-zinc-900 transition hover:bg-zinc-200"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
