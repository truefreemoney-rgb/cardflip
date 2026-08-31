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
    <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 md:grid md:grid-cols-[1fr_auto_1fr] bg-background/85 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent sm:px-6">
      <Logo size="sm" />
      <AppTabs />
      <div className="flex items-center gap-3 sm:gap-4 md:justify-self-end">
        {user && showEbay && (
          user.ebayConnected ? (
            <Link
              href="/connect-ebay"
              title="Manage your eBay connection"
              className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400 transition hover:bg-emerald-400/20"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              eBay connected
            </Link>
          ) : (
            <Link
              href="/connect-ebay"
              className="rounded-full bg-ebay px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ebay-hover"
            >
              eBay setup
            </Link>
          )
        )}
        {user ? (
          <Link
            href="/app/account"
            className="hidden text-sm text-zinc-400 transition hover:text-zinc-200 sm:inline"
          >
            {user.name}
          </Link>
        ) : (
          <span
            aria-hidden
            className={`hidden h-4 w-20 rounded bg-white/10 sm:inline-block ${
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
