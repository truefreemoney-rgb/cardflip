"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import AppTabs from "@/components/AppTabs";
import NavRobot from "@/components/NavRobot";
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

  // "eBay connected · name · Sign out". Rendered twice below: inline at the
  // header's right edge from xl up, its own centered row underneath before
  // that — the strip is ~300px, and only from ~1280px can the centering
  // grid's side columns absorb it without shoving the tabs off center
  // (the original single-row header's bug, Chris 09-01).
  // The help robot rides at the right with the promo pill (Chris, 09-06),
  // not next to the logo.
  const personalStrip = (
    <>
          {user && <NavRobot />}
          {/* Invite a friend (09-06): subscribers and the owner. A pill, not a
              banner — enticing, not loud (Chris: "dont go crazy"). */}
          {user && (user.tier === "subscribed" || user.tier === "owner") && (
            <Link
              href="/app/rewards"
              title="Invite a friend — when they subscribe, you get 500 bonus scans"
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-400/30 bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-brand-200 transition hover:border-brand-400/60 hover:bg-brand-500/25 hover:text-white"
            >
              <span aria-hidden className="text-[10px] text-brand-300">✦</span>
              {/* Phones: just the spark — the header is two rows there
                  (Chris, 09-07: three stacked rows was "a mess"); the
                  title/label carry the meaning. */}
              <span className="sr-only sm:not-sr-only">Unlock 500 Free Scans</span>
            </Link>
          )}
          {user && showEbay && (
            user.ebayConnected ? (
              <Link
                href="/connect-ebay"
                title="Manage your eBay connection"
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-400 transition hover:bg-emerald-400/20"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                eBay Connected
              </Link>
            ) : user.role !== "admin" && user.tier === "trial" ? (
              <Link
                href="/pricing"
                className="rounded-full bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-400"
              >
                Subscribe
              </Link>
            ) : (
              <Link
                href="/connect-ebay"
                className="whitespace-nowrap rounded-full bg-ebay px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-ebay-hover"
              >
                eBay Setup
              </Link>
            )
          )}
          {user ? (
            <Link
              href="/app/account"
              className="hidden max-w-[10rem] truncate py-2 text-xs text-zinc-400 transition hover:text-zinc-200 sm:block"
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
            // Phones sign out from Account (the row has no room); sm+ keeps it here.
            className="hidden py-2 text-xs text-zinc-500 transition hover:text-zinc-300 sm:block"
          >
            Sign out
          </button>
    </>
  );

  return (
    <header className="sticky top-0 z-40 flex flex-col gap-1.5 bg-background/85 px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] sm:gap-2 sm:py-3 sm:pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent sm:px-6">
      {/* Phones: TWO rows — logo + the personal strip share the first line,
          the tab pill takes the second (it is w-full there, so it wraps).
          From sm the grid keeps the tabs centered; the third cell is the
          personal strip from xl up, an empty balancer before that. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 sm:grid sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-2">
          <Logo size="sm" />
        </div>
        <div className="flex items-center gap-1.5 sm:hidden">{personalStrip}</div>
        <AppTabs />
        <div aria-hidden className="hidden sm:block xl:hidden" />
        <div className="hidden items-center gap-4 justify-self-end xl:flex">{personalStrip}</div>
      </div>
      <div className="hidden w-full flex-wrap items-center justify-center gap-4 sm:flex xl:hidden">
        {personalStrip}
      </div>
    </header>
  );
}
