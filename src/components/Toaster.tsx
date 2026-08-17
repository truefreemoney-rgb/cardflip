"use client";

import { useEffect, useState } from "react";

/**
 * Tiny toast bus: `toast("Added to wishlist")` from anywhere on the client,
 * `<Toaster />` mounted once in the app layout renders them bottom-centre
 * (above the thumb on a phone), newest at the bottom, auto-dismiss.
 *
 * No provider/context on purpose — pages already have plenty of state; a
 * confirmation is fire-and-forget. Kinds: ok (default) / err / info.
 */

export type ToastKind = "ok" | "err" | "info";
interface ToastItem { id: number; text: string; kind: ToastKind; }

const EVENT = "cardflip:toast";
let seq = 0;

export function toast(text: string, kind: ToastKind = "ok") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id: ++seq, text, kind } }));
}

const DURATION_MS: Record<ToastKind, number> = { ok: 2600, info: 3200, err: 5000 };

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    function onToast(e: Event) {
      const t = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev.slice(-2), t]); // at most 3 on screen
      timers.set(t.id, setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
        timers.delete(t.id);
      }, DURATION_MS[t.kind]));
    }
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      role="status"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`animate-fade-up pointer-events-auto flex max-w-sm items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-lg shadow-black/50 backdrop-blur-md ${
            t.kind === "err"
              ? "border-red-500/30 bg-red-500/15 text-red-200"
              : t.kind === "info"
                ? "border-edge bg-surface-1/95 text-zinc-200"
                : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
          }`}
        >
          {t.kind === "ok" && (
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
