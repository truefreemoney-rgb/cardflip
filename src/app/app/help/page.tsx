"use client";

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
      <HelpPanel mode="page" active />
    </main>
  );
}
