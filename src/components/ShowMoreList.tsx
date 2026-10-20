"use client";

import { useState, type ReactNode } from "react";

/**
 * A long list that starts folded (Chris, 10-19 phone checks #4: the /cards/<game> sets list
 * was a huge scroll). Every item is in the HTML — the hidden ones are only CSS-hidden — so
 * crawlers still see every set link (internal links are a Search Console gate).
 */
export default function ShowMoreList({
  items,
  initial,
  noun,
  className,
}: {
  items: ReactNode[];
  initial: number;
  /** Plural word for the button: "Show all 212 sets". */
  noun: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const folded = !open && items.length > initial;
  return (
    <>
      <ul className={className}>
        {items.map((item, i) => (
          <li key={i} className={folded && i >= initial ? "hidden" : undefined}>
            {item}
          </li>
        ))}
      </ul>
      {folded && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 w-full rounded-xl border border-edge bg-surface-1 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:border-edge-strong"
        >
          Show all {items.length.toLocaleString("en-US")} {noun}
        </button>
      )}
    </>
  );
}
