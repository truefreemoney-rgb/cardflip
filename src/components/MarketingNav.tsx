"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { fetchCurrentUser } from "@/lib/client/auth";

/**
 * The public-page nav. It checks for a live session so a signed-in seller
 * gets "Logged in — open the app" instead of Log in / Get started — before 08-27 it
 * always showed the logged-out pair, which read as "the homepage logged me
 * out" and sent Chris (and would send any seller) back through the login
 * form on a session that was still perfectly valid. Client-side on purpose:
 * reading cookies() here would drag every marketing page from static to
 * per-request rendering. Until the check answers, the logged-out pair shows
 * — wrong only for the signed-in minority, and only for a moment.
 */
export default function MarketingNav() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCurrentUser()
      .then((user) => {
        if (alive) setSignedIn(Boolean(user));
      })
      .catch(() => {
        if (alive) setSignedIn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <nav className="sticky top-4 z-50 px-4">
      <div className="foil-edge mx-auto flex w-full max-w-4xl items-center justify-between rounded-full py-2 pl-4 pr-2 shadow-xl shadow-black/40 backdrop-blur-md [--foil-fill:rgba(12,14,20,0.82)]">
        <Logo />
        <div className="flex items-center gap-2 text-sm sm:gap-5">
          {/* No admin link here: the dashboard is operator-only (and gated),
              and advertising it on the public nav reads as unfinished. It's
              reachable at /admin and linked from the app for admins. */}
          {signedIn ? (
            <Link
              href="/app"
              className="sheen rounded-full bg-white px-4 py-2 font-medium text-zinc-900 transition hover:bg-zinc-200"
            >
              Open the app
            </Link>
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
