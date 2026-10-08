"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_GROUPS } from "@/components/admin/format";
import type { AdminBadges } from "@/lib/server/adminBadges";

const isActive = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));

function Badge({ b }: { b?: { n: number; tone: "warn" | "good" } }) {
  if (!b) return null;
  return (
    <span
      className={`ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-[18px] ${
        b.tone === "warn" ? "bg-amber-400/20 text-amber-200" : "bg-emerald-400/20 text-emerald-200"
      }`}
    >
      {b.tone === "good" ? "+" : ""}
      {b.n > 99 ? "99+" : b.n}
    </span>
  );
}

/**
 * Console nav (Chris 10-07: 14 pills was too many): four groups on top, the
 * open group's pages underneath, count badges where something needs a look.
 * A group's badge sums its pages' warn counts so a closed group still shows it.
 */
export default function AdminNav({ badges = {} }: { badges?: AdminBadges }) {
  const path = usePathname();
  const current = Math.max(0, ADMIN_NAV_GROUPS.findIndex((g) => g.pages.some(([href]) => isActive(path, href))));
  const [open, setOpen] = useState(current);
  const group = ADMIN_NAV_GROUPS[open];
  const badgeFor = (href: string) => badges[href as keyof AdminBadges];

  return (
    <nav aria-label="Admin sections" className="flex w-full max-w-full flex-col gap-1.5 sm:w-auto">
      <div className="flex items-center gap-1 rounded-full border border-edge bg-surface-1 p-1 text-sm">
        {ADMIN_NAV_GROUPS.map((g, i) => {
          const warn = g.pages.reduce((n, [href]) => n + (badgeFor(href)?.tone === "warn" ? badgeFor(href)!.n : 0), 0);
          const good = g.pages.reduce((n, [href]) => n + (badgeFor(href)?.tone === "good" ? badgeFor(href)!.n : 0), 0);
          const b = warn > 0 ? { n: warn, tone: "warn" as const } : good > 0 ? { n: good, tone: "good" as const } : undefined;
          return (
            <button
              key={g.label}
              type="button"
              onClick={() => setOpen(i)}
              aria-pressed={open === i}
              className={`flex flex-1 items-center justify-center rounded-full px-3 py-1.5 font-medium transition sm:flex-none ${
                open === i ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              {g.label}
              {open !== i && <Badge b={b} />}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1 text-xs">
        {group.pages.map(([href, label]) => {
          const active = isActive(path, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center rounded-full px-3 py-1 transition ${active ? "bg-brand-500/20 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
            >
              {label}
              <Badge b={badgeFor(href)} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
