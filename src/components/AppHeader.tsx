"use client";

import { REFERRALS_ON } from "@/lib/referrals";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import AppTabs from "@/components/AppTabs";
import NavRobot from "@/components/NavRobot";
import ScanCounter from "@/components/ScanCounter";
import { logout } from "@/lib/client/auth";
import { useSession } from "@/components/SessionProvider";
import { SCANS } from "@/lib/pricing";

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
  // The logo always goes to the homepage, signed in or not (Chris 09-30:
  // "it should always bring you to the homepage cardflip.io"; from 09-09 it
  // landed on Inventory or the scanner).
  const logoHref = "/";

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
          {/* Scans left, always in view; tap = more scans (Chris, 09-07). Not
              while the email is unconfirmed: nothing can be scanned or bought yet. */}
          {user && !user.mustConfirmEmail && <ScanCounter user={user} />}
          {/* Invite a friend (09-06): subscribers and the owner. A pill, not a
              banner — enticing, not loud (Chris: "dont go crazy"). */}
          {REFERRALS_ON && user && (user.tier === "subscribed" || user.tier === "owner") && (
            <Link
              href="/app/rewards"
              title={`Invite a friend — when they subscribe, you get ${SCANS.referral} bonus scans`}
              // sm+ only: on a phone the header is two rows (09-07) and an
              // icon-only spark read as "what is this" (Chris) — Account →
              // Rewards carries the invite there.
              className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-400/30 bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-brand-200 transition hover:border-brand-400/60 hover:bg-brand-500/25 hover:text-white sm:flex"
            >
              <span aria-hidden className="text-[10px] text-brand-300">✦</span>
              Unlock {SCANS.referral} Free Scans
            </Link>
          )}
          {/* Pricing only (10-04): no eBay chip; a trial keeps its Subscribe pill. */}
          {user && showEbay && (!user.pricingOnly || user.tier === "trial") && (
            user.ebayConnected && !user.pricingOnly ? (
              <Link
                href="/connect-ebay"
                title="Manage your eBay connection"
                data-tour="header-ebay"
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-400 transition hover:bg-emerald-400/20"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="sm:hidden">eBay</span>
                <span className="hidden sm:inline">eBay Connected</span>
              </Link>
            ) : user.tier === "trial" ? (
              // Payment does not prove the inbox, so a walled account has no Subscribe yet.
              user.mustConfirmEmail ? null : (
                <Link
                  href="/pricing"
                  className="rounded-full bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-400"
                >
                  Subscribe
                </Link>
              )
            ) : (
              <Link
                href="/connect-ebay"
                title="Set up eBay"
                aria-label="Set up eBay"
                data-tour="header-ebay"
                className="whitespace-nowrap rounded-full bg-ebay px-2 py-1 text-xs font-semibold text-white transition hover:bg-ebay-hover sm:px-2.5"
              >
                {/* Phones: "+ eBay" keeps the header one row (Chris 09-30: two rows "looks funky"). */}
                <span className="sm:hidden">+ eBay</span>
                <span className="hidden sm:inline">eBay Setup</span>
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
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-x-3">
        <div className="flex items-center gap-2">
          <Logo size="sm" href={logoHref} />
        </div>
        {/* The before: layers grow every pill/button here to a >= 44px hit area without changing its look. */}
        <div className="flex items-center gap-1 [&_a]:relative [&_button]:relative [&_a]:before:absolute [&_button]:before:absolute [&_a]:before:-inset-x-1 [&_button]:before:-inset-x-1 [&_a]:before:-inset-y-3 [&_button]:before:-inset-y-3 [&_a]:before:content-[''] [&_button]:before:content-[''] sm:hidden">{personalStrip}</div>
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
