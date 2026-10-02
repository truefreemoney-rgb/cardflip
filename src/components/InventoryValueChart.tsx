"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client/basePath";
import type { GameId } from "@/lib/types";
import { formatMoney } from "@/lib/listing";
import RangePills, { rangeDays, rangeWindow, type RangeChoice, type RangePreset } from "@/components/RangePills";

/**
 * Inventory value over time — the strip under the In play / Earned panel
 * (Chris, 09-10: "a graph of their listing value changing over time").
 * Server does the math (/api/cards/value-history); this draws one line and
 * the change over the window. Renders nothing until there are two days.
 */

interface Point {
  day: string;
  value: number;
}

interface Props {
  game: GameId;
  /** Bumped by the page when the pile changes (scan, delete, sale) so the line refetches. */
  version?: number;
  /** The page's status tab ("all" = every status) and category ("all" | "none" = uncategorized | a name): the line follows the list. */
  status?: string;
  category?: string;
  className?: string;
}

const DAY_MS = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const money = (n: number) => formatMoney(n);
/** "Sep 3". */
const dayLabel = (d: string) => new Date(parseDay(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function InventoryValueChart({ game, version = 0, status = "all", category = "all", className = "" }: Props) {
  const [choice, setChoice] = useState<RangeChoice>({ preset: "90d" });
  /** True once the viewer has picked a range: from then on the strip stays up even when a range has too few days to draw. */
  const [picked, setPicked] = useState(false);
  const [points, setPoints] = useState<Point[] | null>(null);
  const from = "from" in choice ? choice.from : "";
  const to = "from" in choice ? choice.to : "";
  const preset = "preset" in choice ? choice.preset : "";

  useEffect(() => {
    let alive = true;
    const scope =
      (status !== "all" ? `&status=${encodeURIComponent(status)}` : "") +
      (category === "none" ? "&uncategorized=1" : category !== "all" ? `&category=${encodeURIComponent(category)}` : "");
    const c: RangeChoice = from ? { from, to } : { preset: preset as RangePreset };
    // The API counts days back from today (two at least: a line needs two points); picked dates are cut out of that here.
    const days = from ? Math.ceil((Date.now() - parseDay(from)) / DAY_MS) + 1 : Math.max(2, rangeDays(c));
    apiFetch(`/api/cards/value-history?game=${game}&days=${days}${scope}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { points?: Point[] } | null) => {
        if (!alive) return;
        const all = body?.points ?? [];
        if (!from) return setPoints(all);
        const w = rangeWindow(c, Date.now());
        setPoints(all.filter((p) => parseDay(p.day) >= w.since && parseDay(p.day) <= w.until));
      })
      .catch(() => {
        if (alive) setPoints([]);
      });
    return () => {
      alive = false;
    };
  }, [game, preset, from, to, version, status, category]);

  const pills = (
    <RangePills
      up
      value={choice}
      onChange={(c) => {
        setPicked(true);
        setChoice(c);
      }}
    />
  );

  const geo = useMemo(() => {
    if (!points || points.length < 2) return null;
    const W = 100, H = 32, PAD = 2;
    const xs = points.map((p) => parseDay(p.day));
    const ys = points.map((p) => p.value);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { lo *= 0.95; hi *= 1.05; }
    const sx = (x: number) => PAD + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD * 2);
    const sy = (y: number) => PAD + (1 - (y - lo) / (hi - lo)) * (H - PAD * 2);
    const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(" ");
    const area = `${line} L${sx(x1).toFixed(1)},${H} L${sx(x0).toFixed(1)},${H} Z`;
    const first = ys[0], last = ys[ys.length - 1];
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    // Each day as a % of the box: the dots, the crosshair and the tooltip are HTML over the stretched drawing, so they stay round and sharp at any width.
    const pts = points.map((p, i) => ({ day: p.day, value: p.value, left: (sx(xs[i]) / W) * 100, top: (sy(ys[i]) / H) * 100 }));
    return { W, H, line, area, pts, hi: Math.max(...ys), lo: Math.min(...ys), hiTop: (sy(Math.max(...ys)) / H) * 100, loTop: (sy(Math.min(...ys)) / H) * 100, first, last, pct, n: points.length };
  }, [points]);
  /** Index of the day under the pointer (checked against the line's length where it is read: a new range is a new line). */
  const [hover, setHover] = useState<number | null>(null);

  if (!geo) {
    // Nothing to draw. Before any pick that means a new inventory: no strip. After one, keep the picker so the viewer can go back.
    if (!picked) return null;
    return (
      <div className={`border-t border-edge/60 px-5 py-3 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">Inventory value</p>
          {pills}
        </div>
        <p className="mt-2 text-xs text-zinc-500">{points === null ? "Loading…" : "Not enough days in this range yet."}</p>
      </div>
    );
  }
  const up = geo.last >= geo.first;
  const stroke = up ? "#34d399" : "#f87171";
  const diff = geo.last - geo.first;
  const tip = geo.pts[hover !== null && hover < geo.pts.length ? hover : geo.pts.length - 1];

  return (
    <div className={`border-t border-edge/60 px-5 py-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-baseline gap-3 text-xs uppercase tracking-[0.15em] text-zinc-500">
          Inventory value
          <span className={`font-medium normal-case tracking-normal tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
            {up ? "▲" : "▼"} {money(Math.abs(diff))} · {Math.abs(geo.pct).toFixed(1)}%
          </span>
        </p>
        {pills}
      </div>
      {/* Read like the price chart (10-02): a value scale (high / low), dates under the line, and a crosshair that names any day's value. */}
      <div className="mt-2 flex gap-2">
        <div
          className="relative h-20 min-w-0 flex-1 touch-pan-y"
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const at = ((e.clientX - box.left) / Math.max(1, box.width)) * 100;
            let best = 0;
            geo.pts.forEach((p, i) => {
              if (Math.abs(p.left - at) < Math.abs(geo.pts[best].left - at)) best = i;
            });
            setHover(best);
          }}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox={`0 0 ${geo.W} ${geo.H}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label={`Inventory value ${up ? "up" : "down"} ${Math.abs(geo.pct).toFixed(1)}% over ${geo.n} days: ${money(geo.first)} to ${money(geo.last)}`}
          >
            <path d={geo.area} fill={stroke} fillOpacity="0.12" />
            <path d={geo.line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* High and low gridlines. */}
          <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/10" style={{ top: `${geo.hiTop}%` }} />
          {geo.hi !== geo.lo && <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/10" style={{ top: `${geo.loTop}%` }} />}
          {/* Today's dot, or the day under the pointer with its line. */}
          {tip && hover !== null && <span className="pointer-events-none absolute inset-y-0 w-px bg-white/20" style={{ left: `${tip.left}%` }} />}
          <span
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#12141f]"
            style={{ left: `${tip.left}%`, top: `${tip.top}%`, backgroundColor: stroke }}
          />
          {hover !== null && (
            <span
              className={`pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md border border-edge bg-[#171a28] px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-200 shadow-lg shadow-black/50 ${tip.left > 50 ? "-translate-x-full" : ""}`}
              style={{ left: `calc(${tip.left}% + ${tip.left > 50 ? -6 : 6}px)` }}
            >
              <span className="text-white">{money(tip.value)}</span> <span className="text-zinc-500">{dayLabel(tip.day)}</span>
            </span>
          )}
        </div>
        <div className="relative w-14 shrink-0 text-[10px] tabular-nums text-zinc-500" aria-hidden>
          <span className="absolute left-0 -translate-y-1/2" style={{ top: `${geo.hiTop}%` }}>{money(geo.hi)}</span>
          {geo.hi !== geo.lo && <span className="absolute left-0 -translate-y-1/2" style={{ top: `${geo.loTop}%` }}>{money(geo.lo)}</span>}
        </div>
      </div>
      <div className="mr-16 mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500" aria-hidden>
        <span>{dayLabel(geo.pts[0].day)}</span>
        {geo.pts.length > 4 && <span>{dayLabel(geo.pts[Math.floor(geo.pts.length / 2)].day)}</span>}
        <span>{dayLabel(geo.pts[geo.pts.length - 1].day)}</span>
      </div>
      <p className="mt-1 text-xs tabular-nums text-zinc-500">
        {money(geo.first)} → <span className="text-zinc-300">{money(geo.last)}</span>
        <span className="ml-1">asking, {geo.n} days</span>
      </p>
    </div>
  );
}
