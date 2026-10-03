"use client";

import Link from "next/link";
import HelpPanel from "@/components/HelpPanel";

/**
 * Help as a page (Chris 09-26): phones land here from the header's Help
 * button instead of a bottom sheet. Scrolls like any page, the composer
 * sticks to the bottom, Back leaves it. Desktop keeps the popover but this
 * URL works there too (the ticket emails link to it).
 */
export default function HelpPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      {/* Phones have no room for a Features link in the header, so the Help page (where the header's Help button lands) carries it (10-03). */}
      <p className="px-4 pt-3 text-xs text-zinc-500">
        Wondering what CardFlip can do?{" "}
        <Link href="/features" className="font-medium text-brand-300 transition hover:text-brand-200">
          See every feature
        </Link>
        .
      </p>
      <HelpPanel mode="page" active />
    </main>
  );
}
