"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/listing";
import { loadSeries, pickSeries, type Series } from "@/components/PriceHistoryChart";
import type { Currency } from "@/lib/types";

/**
 * A wishlist-row-sized version of the price chart: last 30 days as a bare
 * line coloured by direction, with the change beside it. Same data and cache
 * as PriceHistoryChart, so opening the full chart costs nothing extra.
 *
 * Renders nothing until data lands and nothing at all when the card has fewer
 * than two recorded days — a one-point sparkline reads as broken, and the
 * row already shows the saved price.
 */

interface Props {
  cardId: string;
  preferVariant?: string | null;
  /** Days of history to draw (default 30). */
  days?: number;
  className?: string;
}

const dayMs = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);

export default function PriceSparkline({ cardId, preferVariant, days = 30, className = "" }: Props) {
  const [loaded, setLoaded] = useState<{ id: string; series: Series | null }>({ id: "", series: null });
  useEffect(() => {
    let alive = true;
    loadSeries(cardId)
      .then((all) => { if (alive) setLoaded({ id: cardId, series: pickSeries(all, preferVariant) }); })
      .catch(() => { if (alive) setLoaded({ id: cardId, series: null }); });
    return () => { alive = false; };
  }, [cardId, preferVariant]);
  const series = loaded.id === cardId ? loaded.series : null;

  const [now] = useState(() => Date.now());
  const geo = useMemo(() => {
    if (!series || series.points.length < 2) return null;
    const cutoff = now - days * dayMs;
    const inRange = series.points.filter((p) => parseDay(p.day) >= cutoff);
    const pts = inRange.length >= 2 ? inRange : series.points;
    const W = 100, H = 28, PAD = 2;
    const xs = pts.map((p) => parseDay(p.day));
    const ys = pts.map((p) => p.price);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { lo *= 0.95; hi *= 1.05; }
    const sx = (x: number) => PAD + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD * 2);
    const sy = (y: number) => PAD + (1 - (y - lo) / (hi - lo)) * (H - PAD * 2);
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(" ");
    const first = ys[0], last = ys[ys.length - 1];
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    return { W, H, d, lastX: sx(x1), lastY: sy(last), first, last, pct, n: pts.length };
  }, [series, days, now]);

  if (!series || !geo) return null;
  const currency = series.currency as Currency;
  const up = geo.last >= geo.first;
  const stroke = up ? "#34d399" : "#f87171";

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      title={`${geo.n}-day price: ${formatMoney(geo.first, currency)} → ${formatMoney(geo.last, currency)}`}
    >
      <svg
        viewBox={`0 0 ${geo.W} ${geo.H}`}
        className="h-6 w-16 shrink-0"
        role="img"
        aria-label={`Price ${up ? "up" : "down"} ${Math.abs(geo.pct).toFixed(1)}% over ${geo.n} days`}
      >
        <path d={geo.d} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={geo.lastX} cy={geo.lastY} r="2" fill={stroke} />
      </svg>
      <span className={`text-[10px] font-medium tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(geo.pct).toFixed(1)}%
        <span className="ml-1 font-normal text-zinc-600">{days}d</span>
      </span>
    </div>
  );
}
