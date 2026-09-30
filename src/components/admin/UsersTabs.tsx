"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/admin/users", "All Users"],
  ["/admin/users/active", "Active Users"],
] as const;

/**
 * The Users section's two views (Chris 09-30: "add a active users tab to
 * the users section in admin"). Each is its own route, so a view is a
 * shareable link and the heavy All page is untouched. Same pills as the
 * console nav; the top Users pill stays lit on both through startsWith.
 */
export default function UsersTabs() {
  const path = usePathname();
  return (
    <nav aria-label="User views" className="mb-3 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full border border-edge bg-surface-1 p-1 text-xs">
      {TABS.map(([href, label]) => {
        const active = href === "/admin/users" ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 transition ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
