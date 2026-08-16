"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiPath } from "@/lib/client/basePath";
import { formatMoney } from "@/lib/listing";
import type { Currency } from "@/lib/types";

/**
 * How a card's market price has moved — our own daily history (see
 * lib/server/priceHistory.ts). One series at a time: the variant/source the
 * quote is built from, falling back to whichever series has the most points.
 * Line chart, one axis, crosshair + tooltip on hover, min/max direct-labelled;
 * range pills for 30d / 90d / all. Honest when young: a single point says
 * "tracking since <day>" instead of drawing a flat line.
 */

interface Point { day: string; price: number }
interface Series {
  variant: string;
  source: string;
  currency: string;
  points: Point[];
  stats: {
    current: number;
    low30: number | null; high30: number | null;
    low90: number | null; high90: number | null;
    lowAll: number; highAll: number;
    change30: number | null;
    days: number;
  } | null;
}

type Range = 30 | 90 | 0;

interface Props {
  cardId: string;
  /** The variant the shown quote uses ("holofoil", "nonfoil"…) — chart that series first. */
  preferVariant?: string | null;
  /** Tighter layout for the editor's market panel. */
  compact?: boolean;
  className?: string;
}

const cache = new Map<string, Series[]>();

async function loadSeries(cardId: string): Promise<Series[]> {
  const hit = cache.get(cardId);
  if (hit) return hit;
  const res = await fetch(apiPath(`/api/price-history?cardId=${encodeURIComponent(cardId)}`));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { series: Series[] };
  cache.set(cardId, data.series);
  return data.series;
}

function pickSeries(all: Series[], prefer: string | null | undefined): Series | null {
  if (all.length === 0) return null;
  const usd = all.filter((s) => s.currency === "USD");
  const pool = usd.length ? usd : all;
  const byPref = prefer ? pool.filter((s) => s.variant === prefer) : [];
  const ranked = (byPref.length ? byPref : pool)
    .slice()
    .sort((a, b) => b.points.length - a.points.length || (a.source === "tcgplayer" ? -1 : 1));
  return ranked[0] ?? null;
}

function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function PriceHistoryChart({ cardId, preferVariant, compact = false, className = "" }: Props) {
  const [range, setRange] = useState<Range>(90);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Keyed by cardId so a re-open of another card starts from the loading state
  // without a synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{ id: string; series: Series[] | null; failed: boolean }>({ id: "", series: null, failed: false });
  useEffect(() => {
    let alive = true;
    loadSeries(cardId)
      .then((s) => { if (alive) setLoaded({ id: cardId, series: s, failed: false }); })
      .catch(() => { if (alive) setLoaded({ id: cardId, series: null, failed: true }); });
    return () => { alive = false; };
  }, [cardId]);
  const all = loaded.id === cardId ? loaded.series : null;
  const failed = loaded.id === cardId && loaded.failed;

  const series = useMemo(() => (all ? pickSeries(all, preferVariant) : null), [all, preferVariant]);
  const currency = (series?.currency ?? "USD") as Currency;

  // "Now" is captured once per mount — the range cut-off doesn't need to tick.
  const [now] = useState(() => Date.now());
  const shown = useMemo(() => {
    if (!series) return [];
    if (range === 0) return series.points;
    const cutoff = now - range * 86_400_000;
    return series.points.filter((p) => Date.parse(`${p.day}T00:00:00Z`) >= cutoff);
  }, [series, range, now]);

  // Geometry — the viewBox width follows the rendered width so text keeps
  // its aspect (a fixed 320 letterboxes inside a wide modal), height is fixed.
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Measure once immediately (ResizeObserver only reports after a layout
    // pass — a hidden or backgrounded tab may not get one for a while).
    const initial = Math.round(el.getBoundingClientRect().width);
    if (initial > 0) setW(initial);
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = compact ? 84 : 132;
  const PAD = { l: 6, r: 6, t: 14, b: 18 };
  const geo = useMemo(() => {
    if (shown.length < 2) return null;
    const xs = shown.map((p) => Date.parse(`${p.day}T00:00:00Z`));
    const ys = shown.map((p) => p.price);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { lo *= 0.95; hi *= 1.05; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const sx = (x: number) => PAD.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
    const sy = (y: number) => PAD.t + (1 - (y - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const pts = shown.map((p, i) => ({ x: sx(xs[i]), y: sy(p.price), p }));
    const d = pts.map((q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
    const area = `${d} L${pts[pts.length - 1].x.toFixed(1)},${(H - PAD.b).toFixed(1)} L${pts[0].x.toFixed(1)},${(H - PAD.b).toFixed(1)} Z`;
    let minI = 0, maxI = 0;
    ys.forEach((y, i) => { if (y < ys[minI]) minI = i; if (y > ys[maxI]) maxI = i; });
    const grid = [0.25, 0.5, 0.75].map((f) => PAD.t + f * (H - PAD.t - PAD.b));
    return { pts, d, area, minI, maxI, grid, lo, hi };
  }, [shown, W, H, PAD.b, PAD.l, PAD.r, PAD.t]);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!geo || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < geo.pts.length; i++) {
      if (Math.abs(geo.pts[i].x - x) < Math.abs(geo.pts[best].x - x)) best = i;
    }
    setHover(best);
  }

  const first = shown[0];
  const last = shown[shown.length - 1];
  const change = first && last && first.price > 0 ? ((last.price - first.price) / first.price) * 100 : null;
  const rangeLo = geo ? shown[geo.minI].price : null;
  const rangeHi = geo ? shown[geo.maxI].price : null;

  const label = compact ? "text-[10px]" : "text-[11px]";

  return (
    <section className={`rounded-2xl border border-edge bg-surface-1 ${compact ? "p-3" : "p-4"} ${className}`} aria-label="Price history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className={`${compact ? "text-xs" : "text-sm"} font-medium text-zinc-200`}>Price history</h3>
          {series && (
            <span className={`${label} text-zinc-500`}>
              {series.source === "tcgplayer" ? "TCGplayer" : series.source === "cardmarket" ? "Cardmarket" : series.source}
              {series.variant && series.variant !== "normal" ? ` · ${series.variant}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="Range">
          {([30, 90, 0] as Range[]).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              onClick={() => { setRange(r); setHover(null); }}
              className={`rounded-full px-2 py-0.5 ${label} transition ${
                range === r ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {r === 0 ? "All" : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {failed && <p className={`mt-2 ${label} text-zinc-500`}>Couldn&apos;t load price history.</p>}
      {!failed && all === null && <div className="mt-2 animate-pulse rounded-lg bg-white/5" style={{ height: H }} aria-hidden />}

      {all !== null && !series && (
        <p className={`mt-2 ${label} text-zinc-500`}>
          No history yet — this card&apos;s price is recorded from today, and a chart appears as points accumulate.
        </p>
      )}

      {series && shown.length < 2 && (
        <p className={`mt-2 ${label} text-zinc-500`}>
          {series.points.length < 2
            ? `Tracking since ${shortDay(series.points[0].day)} — one point so far; the chart draws itself as days go by.`
            : `Only one point in this range. Try a wider range.`}
        </p>
      )}

      <div ref={boxRef} className="w-full" />
      {geo && (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="mt-2 block w-full touch-none select-none"
            style={{ height: H }}
            role="img"
            aria-label={`Price from ${formatMoney(first.price, currency)} on ${shortDay(first.day)} to ${formatMoney(last.price, currency)} on ${shortDay(last.day)}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={`ph-fill-${cardId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand-400)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--color-brand-400)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {geo.grid.map((y) => (
              <line key={y} x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            ))}
            <path d={geo.area} fill={`url(#ph-fill-${cardId})`} />
            <path d={geo.d} fill="none" stroke="var(--color-brand-400)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {/* Direct labels on the range's low and high — the two numbers a seller wants. */}
            {[geo.maxI, geo.minI].map((i, k) => {
              const q = geo.pts[i];
              const isMax = k === 0;
              const anchor = q.x > W * 0.8 ? "end" : q.x < W * 0.2 ? "start" : "middle";
              return (
                <g key={isMax ? "max" : "min"}>
                  <circle cx={q.x} cy={q.y} r="3" fill="var(--color-brand-300)" stroke="#08090d" strokeWidth="2" />
                  <text
                    x={q.x}
                    y={isMax ? q.y - 6 : q.y + 12}
                    textAnchor={anchor}
                    fontSize="10"
                    fill="rgb(212 212 216)"
                    fontFamily="var(--font-geist-mono), ui-monospace, monospace"
                  >
                    {formatMoney(q.p.price, currency)}
                  </text>
                </g>
              );
            })}
            {/* x-axis: first and last day only; the crosshair gives the rest. */}
            <text x={PAD.l} y={H - 4} fontSize="9" fill="rgb(113 113 122)">{shortDay(first.day)}</text>
            <text x={W - PAD.r} y={H - 4} fontSize="9" fill="rgb(113 113 122)" textAnchor="end">{shortDay(last.day)}</text>
            {hover !== null && geo.pts[hover] && (
              <g pointerEvents="none">
                <line x1={geo.pts[hover].x} x2={geo.pts[hover].x} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                <circle cx={geo.pts[hover].x} cy={geo.pts[hover].y} r="4" fill="var(--color-brand-300)" stroke="#08090d" strokeWidth="2" />
              </g>
            )}
          </svg>
          <div className={`mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${label} text-zinc-500`}>
            <span aria-live="polite" className="tabular-nums text-zinc-300">
              {hover !== null && geo.pts[hover]
                ? `${shortDay(geo.pts[hover].p.day)} · ${formatMoney(geo.pts[hover].p.price, currency)}`
                : `Now ${formatMoney(last.price, currency)}`}
            </span>
            <span className="tabular-nums">
              Low {formatMoney(rangeLo, currency)} · High {formatMoney(rangeHi, currency)}
              {change !== null && (
                <span className={`ml-2 ${change > 0 ? "text-emerald-400" : change < 0 ? "text-red-400" : "text-zinc-400"}`}>
                  {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {Math.abs(change).toFixed(1)}%
                </span>
              )}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
