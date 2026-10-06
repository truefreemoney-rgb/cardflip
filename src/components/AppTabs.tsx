"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app", label: "Scanner", tour: "tab-scanner" },
  { href: "/app/collection", label: "Inventory", tour: "tab-inventory" },
  { href: "/app/price-check", label: "Search Cards", tour: "tab-search" },
  // "Watchlist" to the user; the route and code stay `wishlist`.
  { href: "/app/wishlist", label: "Watchlist", tour: "tab-watchlist" },
];

/**
 * The top tab pill, md+ only: the four tabs, a Features tab and the Profile
 * button (Chris 10-03: "on desktop, you can just put a feature button on the
 * top nav"). Phones (< md) use the fixed BottomTabBar instead (audit E4); its
 * Account tab replaced the old gear menu.
 */
export default function AppTabs() {
  const pathname = usePathname();
  const accountActive = pathname.startsWith("/app/account");

  return (
    <nav className="foil-edge hidden w-auto items-center gap-1 rounded-full p-1 [--foil-fill:#101218] md:flex">
      {TABS.map((tab) => {
        const active =
          tab.href === "/app" ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            data-tour={tab.tour}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-center text-sm font-medium transition ${
              active
                ? "bg-brand-500 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}

      <Link
        href="/features"
        className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium text-zinc-400 transition hover:text-zinc-200"
      >
        Features
      </Link>
      <Link
        href="/app/account"
        aria-label="Profile and account settings"
        title="Profile"
        aria-current={accountActive ? "page" : undefined}
        className={`flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 transition ${
          accountActive ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="10" cy="7" r="3.2" />
          <path d="M3.8 17c.9-3 3.3-4.5 6.2-4.5s5.3 1.5 6.2 4.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-medium">Profile</span>
      </Link>
    </nav>
  );
}
