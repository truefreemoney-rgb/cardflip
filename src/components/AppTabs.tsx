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
    </nav>
  );
}
