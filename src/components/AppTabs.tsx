"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app", label: "Scanner" },
  { href: "/app/collection", label: "My cards" },
  { href: "/app/price-check", label: "Search cards" },
  // "Watchlist" to the user; the route and code stay `wishlist`.
  { href: "/app/wishlist", label: "Watchlist" },
];

export default function AppTabs() {
  const pathname = usePathname();
  const accountActive = pathname.startsWith("/app/account");

  return (
    <nav className="foil-edge flex w-full items-center gap-0.5 rounded-full p-1 [--foil-fill:#101218] sm:w-auto sm:gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex-1 whitespace-nowrap rounded-full px-1 py-1.5 text-center text-[13px] font-medium transition sm:flex-none sm:px-3.5 sm:text-sm ${
              active
                ? "bg-brand-500 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
      {/* Account: an icon, not a fifth word — the four text tabs already fill a phone. */}
      <Link
        href="/app/account"
        aria-label="Profile and account settings"
        title="Profile"
        aria-current={accountActive ? "page" : undefined}
        className={`flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-full transition sm:w-auto sm:px-3.5 ${
          accountActive ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="10" cy="7" r="3.2" />
          <path d="M3.8 17c.9-3 3.3-4.5 6.2-4.5s5.3 1.5 6.2 4.5" strokeLinecap="round" />
        </svg>
        {/* Icon-only on phones — the four text tabs already fill the pill there. */}
        <span className="hidden text-sm font-medium sm:inline">Profile</span>
      </Link>
    </nav>
  );
}
