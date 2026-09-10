"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client/basePath";
import type { GameId } from "@/lib/types";

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
  className?: string;
}

const RANGES: { days: number; label: string }[] = [
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
];

const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const money = (n: number) => `$${n.toFixed(2)}`;

export default function InventoryValueChart({ game, version = 0, className = "" }: Props) {
  const [days, setDays] = useState(90);
  const [points, setPoints] = useState<Point[] | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/cards/value-history?game=${game}&days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { points?: Point[] } | null) => {
        if (alive) setPoints(body?.points ?? []);
      })
      .catch(() => {
        if (alive) setPoints([]);
      });
    return () => {
      alive = false;
    };
  }, [game, days, version]);

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

  if (!geo) return null;
  const up = geo.last >= geo.first;
  const stroke = up ? "#34d399" : "#f87171";
  const diff = geo.last - geo.first;

  return (
    <div className={`border-t border-edge/60 px-5 py-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">Inventory value</p>
        <div className="flex items-baseline gap-3 text-xs">
          <span className={`font-medium tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
            {up ? "▲" : "▼"} {money(Math.abs(diff))} · {Math.abs(geo.pct).toFixed(1)}%
          </span>
          <span className="flex gap-1" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setDays(r.days)}
                aria-pressed={days === r.days}
                className={`rounded-md px-1.5 py-0.5 tabular-nums transition ${
                  days === r.days ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {r.label}
              </button>
            ))}
          </span>
        </div>
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
