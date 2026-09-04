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
 *
 * 09-04 (Chris: "I still don't like how it looks"): the floating foil
 * capsule is gone. This is the app's own header chrome — flat, full-width,
 * sticky, holo hairline underneath — so the marketing site and the product
 * read as one thing. Links sit right, in one row, one weight.
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

  const link = "px-2.5 py-2 text-sm text-zinc-400 transition hover:text-white";

  return (
    <header className="sticky top-0 z-50 bg-background/85 backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1 sm:gap-2">
          <Link href="/#how-it-works" className={`${link} hidden sm:inline-block`}>
            How it works
          </Link>
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
                className="ml-1 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
              >
                Open the app
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className={link}>
                Log in
              </Link>
              <Link
                href="/signup"
                className="ml-1 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
