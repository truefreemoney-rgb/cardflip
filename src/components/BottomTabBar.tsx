"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ICON = {
  className: "h-6 w-6",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const TABS: { href: string; label: string; tour: string; icon: ReactNode; primary?: boolean }[] = [
  {
    href: "/app/collection",
    label: "Inventory",
    tour: "tab-inventory",
    icon: (
      <svg {...ICON}>
        <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
        <path d="M8 8.5h8M8 12.5h8M8 16.5h5" />
      </svg>
    ),
  },
  {
    href: "/app/price-check",
    label: "Search",
    tour: "tab-search",
    icon: (
      <svg {...ICON}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20 20-4.2-4.2" />
      </svg>
    ),
  },
  {
    href: "/app",
    label: "Scanner",
    tour: "tab-scanner",
    primary: true,
    icon: (
      <svg {...ICON} className="h-7 w-7">
        <path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    href: "/app/wishlist",
    label: "Watchlist",
    tour: "tab-watchlist",
    icon: (
      <svg {...ICON}>
        <path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.8a4.3 4.3 0 0 1 7.5 2.7c0 5.4-7.5 10-7.5 10z" />
      </svg>
    ),
  },
  {
    href: "/app/account",
    label: "Account",
    tour: "tab-account",
    icon: (
      <svg {...ICON}>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20c.9-3.6 3.6-5.4 7-5.4s6.1 1.8 7 5.4" />
      </svg>
    ),
  },
];

/**
 * Phones only (< md): the app's main tabs as a fixed bottom bar, one thumb
 * from anywhere. Solid background, >= 56px targets, iPhone home-bar padding.
 * z-40 sits under every modal and the full-screen camera (z-50+), so those
 * cover it. The layout publishes --bottom-nav-h (same height) for content
 * padding and the Toaster offset.
 */
export default function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-edge-strong bg-[#0d0e15] pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-14 items-stretch">
        {TABS.map((tab) => {
          const active =
            tab.href === "/app" ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              data-tour={tab.tour}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
                active ? "text-brand-300" : "text-zinc-400 active:text-zinc-200"
              }`}
            >
              <span
                className={`flex items-center justify-center rounded-full transition ${
                  tab.primary
                    ? `h-9 w-14 ${active ? "bg-brand-500 text-white" : "bg-brand-500/25 text-brand-200"}`
                    : `h-7 w-12 ${active ? "bg-brand-500/20" : ""}`
                }`}
              >
                {tab.icon}
              </span>
              <span className={active ? "font-semibold" : ""}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
