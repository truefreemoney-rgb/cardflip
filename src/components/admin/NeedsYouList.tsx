"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export interface NeedsYouItem {
  href: string;
  text: string;
  tone: "warn" | "bad" | "info";
}

const STORE = "cardflip.admin.needsYouClosed";

/**
 * The overview's "Needs you" rows with a ✕ on each (Chris 09-30: "can i get
 * close buttons for these"). A closed row stays closed for the rest of the
 * Eastern day and only while its text is the same, so "2 server errors" comes
 * back after "1 server error" was closed, and tomorrow starts fresh. Kept in
 * this browser only (it is one person's to-do view, not shared state).
 */
export default function NeedsYouList({ items, day }: { items: NeedsYouItem[]; day: string }) {
  const [closed, setClosed] = useState<string[] | null>(null);

  useEffect(() => {
    let saved: string[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) ?? "null") as { day?: string; keys?: string[] } | null;
      if (raw?.day === day && Array.isArray(raw.keys)) saved = raw.keys;
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only storage, read once after hydration
    setClosed(saved);
  }, [day]);

  function save(keys: string[]) {
    setClosed(keys);
    try {
      localStorage.setItem(STORE, JSON.stringify({ day, keys }));
    } catch {}
  }

  const shut = closed ?? [];
  const open = items.filter((a) => !shut.includes(a.text));
  const hidden = items.length - open.length;

  return (
    <div className="rounded-2xl border border-edge bg-surface-1 px-4 py-3">
      {open.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-zinc-300">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
          <span className="flex-1">
            {items.length === 0 ? "All quiet. No tickets waiting, no errors, every connected site has posted today." : "All clear for today."}
          </span>
          {hidden > 0 && (
            <button type="button" onClick={() => save([])} className="text-xs text-zinc-500 transition hover:text-zinc-300">
              Show {hidden} Closed
            </button>
          )}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-white/5">
            {open.map((a) => (
              <li key={a.text} className="flex items-center gap-1">
                <Link href={a.href} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-sm text-zinc-200 hover:text-white">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${a.tone === "bad" ? "bg-rose-400" : a.tone === "warn" ? "bg-amber-400" : "bg-sky-400"}`} />
                  <span className="min-w-0 flex-1">{a.text}</span>
                  <span className="text-xs text-zinc-600">Open</span>
                </Link>
                <button
                  type="button"
                  onClick={() => save([...shut, a.text])}
                  aria-label={`Close: ${a.text}`}
                  title="Close for today"
                  className="-mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button type="button" onClick={() => save([])} className="mt-1 text-xs text-zinc-500 transition hover:text-zinc-300">
              Show {hidden} Closed
            </button>
          )}
        </>
      )}
    </div>
  );
}
