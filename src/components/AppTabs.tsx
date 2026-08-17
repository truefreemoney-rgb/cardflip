"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app", label: "Scanner" },
  { href: "/app/collection", label: "My cards" },
  { href: "/app/price-check", label: "Search cards" },
  { href: "/app/wishlist", label: "Wishlist" },
];

export default function AppTabs() {
  const pathname = usePathname();
  const accountActive = pathname.startsWith("/app/account");

  return (
    <nav className="foil-edge flex items-center gap-1 rounded-full p-1 [--foil-fill:#101218]">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
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
        aria-label="Account settings"
        title="Account"
        aria-current={accountActive ? "page" : undefined}
        className={`ml-0.5 flex h-8 w-8 items-center justify-center rounded-full transition ${
          accountActive ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="10" cy="7" r="3.2" />
          <path d="M3.8 17c.9-3 3.3-4.5 6.2-4.5s5.3 1.5 6.2 4.5" strokeLinecap="round" />
        </svg>
      </Link>
    </nav>
  );
}
