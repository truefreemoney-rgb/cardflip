"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/lib/client/auth";

const TABS = [
  { href: "/app", label: "Scanner", tour: "tab-scanner" },
  { href: "/app/collection", label: "Inventory", tour: "tab-inventory" },
  { href: "/app/price-check", label: "Search Cards", tour: "tab-search" },
  // "Watchlist" to the user; the route and code stay `wishlist`.
  { href: "/app/wishlist", label: "Watchlist", tour: "tab-watchlist" },
];

export default function AppTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const accountActive = pathname.startsWith("/app/account");
  // The gear menu (Chris 10-03: the phone header has no room for one more
  // word, "make it a gear icon or something"): Account, Features, Sign out.
  // It replaced the profile icon, which only went to Account.
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "block w-full px-4 py-2.5 text-left text-sm text-zinc-200 transition hover:bg-surface-2 hover:text-white";

  return (
    <nav className="foil-edge flex w-full items-center gap-0.5 rounded-full p-1 [--foil-fill:#101218] sm:w-auto sm:gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            data-tour={tab.tour}
            className={`flex-1 whitespace-nowrap rounded-full px-1 py-2 text-center text-[13px] font-medium transition sm:flex-none sm:px-3.5 sm:py-1.5 sm:text-sm ${
              active
                ? "bg-brand-500 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
      {/* The gear: an icon, not a fifth word — the four text tabs already fill a phone. */}
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu: account, features, sign out"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Menu"
          className={`flex h-9 w-9 items-center justify-center rounded-full transition sm:h-8 sm:w-8 ${
            accountActive || open ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="10" cy="10" r="2.6" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 2.5v2.1M10 15.4v2.1M2.5 10h2.1M15.4 10h2.1M4.7 4.7l1.5 1.5M13.8 13.8l1.5 1.5M4.7 15.3l1.5-1.5M13.8 6.2l1.5-1.5"
            />
          </svg>
        </button>
        {open && (
          <div role="menu" className="panel-solid absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border py-1 shadow-2xl shadow-black/70">
            <Link href="/app/account" role="menuitem" onClick={() => setOpen(false)} className={item}>
              Account
            </Link>
            <Link href="/features" role="menuitem" onClick={() => setOpen(false)} className={item}>
              Features
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await logout();
                router.push("/");
              }}
              className={`${item} border-t border-edge text-zinc-400`}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
