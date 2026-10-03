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

/**
 * The tab pill. From sm up: the four tabs, a Features tab and the Profile
 * button, as before (Chris 10-03: "on desktop, you can just put a feature
 * button on the top nav, no need to mess with the profile button"). On
 * phones the four text tabs fill the pill, so the profile icon is a gear
 * that opens a small menu: Account, Features, Sign out ("make it a gear
 * icon or something").
 */
export default function AppTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const accountActive = pathname.startsWith("/app/account");
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

      {/* sm+: Features tab + the Profile button, unchanged. */}
      <Link
        href="/features"
        className="hidden whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium text-zinc-400 transition hover:text-zinc-200 sm:block"
      >
        Features
      </Link>
      <Link
        href="/app/account"
        aria-label="Profile and account settings"
        title="Profile"
        aria-current={accountActive ? "page" : undefined}
        className={`hidden h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 transition sm:flex ${
          accountActive ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="10" cy="7" r="3.2" />
          <path d="M3.8 17c.9-3 3.3-4.5 6.2-4.5s5.3 1.5 6.2 4.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-medium">Profile</span>
      </Link>

      {/* Phones: the gear menu. */}
      <div ref={menuRef} className="relative shrink-0 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu: account, features, sign out"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Menu"
          className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
            accountActive || open ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {/* A cog with teeth (Chris 10-03: the spoked one "looks more like a sun"). */}
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.9 4.6h.1a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.1a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
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
