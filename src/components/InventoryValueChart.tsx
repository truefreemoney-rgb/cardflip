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
    return { W, H, line, area, lastX: sx(x1), lastY: sy(last), first, last, pct, n: points.length };
  }, [points]);

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
      <svg
        viewBox={`0 0 ${geo.W} ${geo.H}`}
        preserveAspectRatio="none"
        className="mt-1.5 h-12 w-full"
        role="img"
        aria-label={`Inventory value ${up ? "up" : "down"} ${Math.abs(geo.pct).toFixed(1)}% over ${geo.n} days: ${money(geo.first)} to ${money(geo.last)}`}
      >
        <path d={geo.area} fill={stroke} fillOpacity="0.12" />
        <path d={geo.line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={geo.lastX} cy={geo.lastY} r="1.6" fill={stroke} />
      </svg>
      <p className="mt-1 text-xs tabular-nums text-zinc-500">
        {money(geo.first)} → <span className="text-zinc-300">{money(geo.last)}</span>
        <span className="ml-1">asking, {geo.n} days</span>
      </p>
    </div>
  );
}
