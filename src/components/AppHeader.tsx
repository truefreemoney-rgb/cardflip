"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import AppTabs from "@/components/AppTabs";
import { logout } from "@/lib/client/auth";
import { useSession } from "@/components/SessionProvider";

/**
 * The one sticky header for the signed-in app. Rendered by the /app layout so
 * it survives tab switches; while the session is still loading it keeps the
 * same shape with a placeholder where the name goes, so nothing jumps.
 */
export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, status } = useSession();
  // The account page has its own eBay section, so the chip is noise there.
  const showEbay = !pathname.startsWith("/app/account");

  return (
    <header className="sticky top-0 z-40 flex flex-col gap-2 bg-background/85 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent sm:px-6">
      {/* Row 1: logo left, tabs centered against a symmetric grid.
          Row 2: the personal strip ("eBay connected · name · Sign out")
          centered under the tabs (Chris, 09-01) — off in its own row it can
          be any width without pushing the tabs off center. */}
      {/* The grid kicks in from sm — between sm and md the old md: cutoff
          left a plain justify-between flex, which parked the tabs at the
          right edge (visible with browser zoom, Chris's screenshot 09-01).
          Below sm the tabs wrap to their own full-width line. */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr]">
        <Logo size="sm" />
        <AppTabs />
        <div aria-hidden className="hidden sm:block" />
      </div>
      <div className="flex w-full items-center justify-center gap-4">
          {user && showEbay && (
            user.ebayConnected ? (
              <Link
                href="/connect-ebay"
                title="Manage your eBay connection"
                className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-400/20"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                eBay connected
              </Link>
            ) : (
              <Link
                href="/connect-ebay"
                className="rounded-full bg-ebay px-2.5 py-0.5 text-xs font-semibold text-white transition hover:bg-ebay-hover"
              >
                eBay setup
              </Link>
            )
          )}
          {user ? (
            <Link
              href="/app/account"
              className="text-xs text-zinc-400 transition hover:text-zinc-200"
            >
              {user.name}
            </Link>
          ) : (
            <span
              aria-hidden
              className={`h-3.5 w-20 rounded bg-white/10 ${
                status === "loading" ? "animate-pulse" : ""
              }`}
            />
          )}
          <button
            onClick={async () => {
              await logout();
              router.push("/");
            }}
            className="text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            Sign out
          </button>
      </div>
    </header>
  );
}
