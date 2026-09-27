"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Today's date in Eastern time, as the value a date input wants. */
function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * The "Dates" pill on the analytics range switch. Opens a small panel with
 * two native date inputs (the browser's own popup calendar) and Show, which
 * loads /admin/analytics?from=&to=. `up` opens the panel above the pill for
 * the bottom bar on phones.
 */
export default function RangeDates({ from, to, active, up = false }: { from?: string; to?: string; active: boolean; up?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(from ?? "");
  const [b, setB] = useState(to ?? todayEt());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const ok = a !== "" && b !== "" && a <= b;
  function show() {
    if (!ok) return;
    setOpen(false);
    router.push(`/admin/analytics?from=${a}&to=${b}`);
  }

  const input = "rounded-lg border border-edge bg-black/30 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-brand-400/60 [color-scheme:dark]";

  return (
    <div ref={box} className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full rounded-full px-3 py-1.5 text-center transition ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
      >
        Dates
      </button>
      {open && (
        <div className={`absolute right-0 z-40 w-64 rounded-2xl border border-edge-strong bg-[#171a28] p-3 shadow-xl shadow-black/60 ${up ? "bottom-full mb-2" : "top-full mt-2"}`}>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">From</span>
            <input className={`${input} w-full`} type="date" value={a} max={b || undefined} onChange={(e) => setA(e.target.value)} />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">To</span>
            <input className={`${input} w-full`} type="date" value={b} min={a || undefined} max={todayEt()} onChange={(e) => setB(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={show}
            disabled={!ok}
            className="mt-3 w-full rounded-full bg-brand-500 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-400 disabled:opacity-40"
          >
            Show These Days
          </button>
        </div>
      )}
    </div>
  );
}
