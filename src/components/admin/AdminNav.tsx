"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "@/components/admin/format";

/** Console nav — one pill per page, the current one lit. */
export default function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-edge bg-surface-1 p-1 text-xs">
      {ADMIN_NAV.map(([href, label]) => {
        const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1 transition ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
