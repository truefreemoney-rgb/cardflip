"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The one date changer (Chris 10-02: "all date changers site-wide should be
 * like this"): the admin Analytics pill — Dates, 24h, 7 days, 30 days,
 * 90 days — for charts that switch range in the browser. Analytics itself
 * keeps its link-driven twin (app/admin/(console)/analytics/page.tsx +
 * components/admin/RangeDates.tsx); the look and the options are the same.
 */
export type RangePreset = "24h" | "7d" | "30d" | "90d";
export type RangeChoice = { preset: RangePreset } | { from: string; to: string };

/** `short` is the sentence form charts use ("3M low $4"). */
/** `tight` is the pill label inside a box under 24rem (the homepage tile, 10-02) when the pill is asked to `fit`. */
export const RANGE_PRESETS: { id: RangePreset; label: string; tight: string; days: number; short: string }[] = [
  { id: "24h", label: "24h", tight: "24h", days: 1, short: "24h" },
  { id: "7d", label: "7 days", tight: "7d", days: 7, short: "1W" },
  { id: "30d", label: "30 days", tight: "30d", days: 30, short: "1M" },
  { id: "90d", label: "90 days", tight: "90d", days: 90, short: "3M" },
];

const DAY_MS = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const isDates = (c: RangeChoice): c is { from: string; to: string } => "from" in c;

/** Days a preset counts back; a custom range's length in days. */
export function rangeDays(c: RangeChoice): number {
  if (!isDates(c)) return RANGE_PRESETS.find((p) => p.id === c.preset)!.days;
  return Math.round((parseDay(c.to) - parseDay(c.from)) / DAY_MS) + 1;
}

/**
 * The window a choice covers on a one-point-a-day series, in ms (both ends
 * included). A preset counts whole days back from `now`'s day, so "24h" is
 * yesterday's point and today's.
 */
export function rangeWindow(c: RangeChoice, now: number): { since: number; until: number } {
  if (isDates(c)) return { since: parseDay(c.from), until: parseDay(c.to) + DAY_MS - 1 };
  return { since: Math.floor(now / DAY_MS) * DAY_MS - rangeDays(c) * DAY_MS, until: Infinity };
}

/** "3M" for a preset, "Sep 1 to Oct 2" for dates. */
export function rangeShort(c: RangeChoice): string {
  if (!isDates(c)) return RANGE_PRESETS.find((p) => p.id === c.preset)!.short;
  const f = (d: string) => new Date(parseDay(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(c.from)} to ${f(c.to)}`;
}

/** Today's date where the viewer is, as the value a date input wants. */
function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** `up` opens the Dates panel above the pill (for a pill at the bottom of a clipped box, like the Inventory summary). */
/** `fit`: inside a `@container` under 24rem the preset labels go short ("30d") so five pills never spill past a narrow panel. */
export default function RangePills({ value, onChange, up = false, fit = false, className = "" }: { value: RangeChoice; onChange: (c: RangeChoice) => void; up?: boolean; fit?: boolean; className?: string }) {
  const custom = isDates(value) ? value : null;
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(custom?.from ?? "");
  const [b, setB] = useState(custom?.to ?? "");
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
    onChange({ from: a, to: b });
  }

  // min-w-0 + flex-1 everywhere: in a box narrower than the five labels (the homepage tile, 10-02 "running over")
  // the buttons shrink instead of the group spilling past its panel.
  const pill = (on: boolean) => `min-w-0 rounded-full px-2 py-1.5 text-center transition sm:px-2.5 ${on ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`;
  const input = "rounded-lg border border-edge bg-black/30 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-brand-400/60 [color-scheme:dark]";

  return (
    <div role="group" aria-label="Range" className={`flex w-full max-w-full items-center gap-1 rounded-full border border-edge bg-surface-1/95 p-1 text-xs sm:w-auto ${className}`}>
      <div ref={box} className="relative flex-1 sm:flex-none">
        <button
          type="button"
          onClick={() => {
            if (!open && !b) setB(today());
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-pressed={custom !== null}
          className={`w-full ${pill(custom !== null)}`}
        >
          Dates
        </button>
        {open && (
          <div className={`absolute left-0 z-40 w-64 ${up ? "bottom-full mb-2" : "top-full mt-2"} rounded-2xl border border-edge-strong bg-[#171a28] p-3 text-left shadow-xl shadow-black/60`}>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">From</span>
              <input className={`${input} w-full`} type="date" value={a} max={b || undefined} onChange={(e) => setA(e.target.value)} />
            </label>
            <label className="mt-2 block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">To</span>
              <input className={`${input} w-full`} type="date" value={b} min={a || undefined} max={today()} onChange={(e) => setB(e.target.value)} />
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
      {RANGE_PRESETS.map((r) => {
        const on = custom === null && !isDates(value) && value.preset === r.id;
        return (
          <button key={r.id} type="button" onClick={() => onChange({ preset: r.id })} aria-pressed={on} className={`flex-1 whitespace-nowrap sm:flex-none ${pill(on)}`}>
            {fit ? (
              <>
                <span className="@[24rem]:hidden">{r.tight}</span>
                <span className="hidden @[24rem]:inline">{r.label}</span>
              </>
            ) : (
              r.label
            )}
          </button>
        );
      })}
    </div>
  );
}
