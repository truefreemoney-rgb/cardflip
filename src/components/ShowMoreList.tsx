"use client";

import { useState, type ReactNode } from "react";

/**
 * A long list that starts folded and grows a step at a time (Chris, 10-19 phone checks #4: the
 * /cards/<game> sets list was a huge scroll; 10-19: "show 20 more, not all sets"). Every item is
 * in the HTML — the hidden ones are only CSS-hidden — so crawlers still see every set link
 * (internal links are a Search Console gate).
 */
export default function ShowMoreList({
  items,
  initial,
  step,
  noun,
  className,
}: {
  items: ReactNode[];
  initial: number;
  /** How many more each tap reveals. */
  step: number;
  /** Plural word for the button: "Show 20 more sets". */
  noun: string;
  className?: string;
}) {
  const [shown, setShown] = useState(initial);
  const left = items.length - shown;
  return (
    <>
      <ul className={className}>
        {items.map((item, i) => (
          <li key={i} className={i >= shown ? "hidden" : undefined}>
            {item}
          </li>
        ))}
      </ul>
      {left > 0 && (
        <button
          type="button"
          onClick={() => setShown((n) => n + step)}
          className="mt-3 w-full rounded-xl border border-edge bg-surface-1 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:border-edge-strong"
        >
          Show {Math.min(step, left)} more {noun}
          <span className="text-zinc-500"> · {left.toLocaleString("en-US")} left</span>
        </button>
      )}
    </>
  );
}
