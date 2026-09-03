"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiPath } from "@/lib/client/basePath";
import { formatMoney } from "@/lib/listing";
import type { Currency, PokemonCard } from "@/lib/types";

/**
 * A card's price over time, drawn like a stock chart: quote header (current
 * price, change for the selected range), 1W/1M/3M/1Y/All, price axis with
 * gridlines, date ticks, line + area coloured by direction (up = emerald,
 * down = red), crosshair + tooltip on hover, min/max direct-labelled.
 *
 * Data is our own daily history (lib/server/priceHistory.ts). One series at
 * a time: the variant/source the quote is built from, else the longest. A
 * card with a single point (Pokémon on day one — history accrues from the
 * deploy) still draws: a flat line at that price with today's dot, so it
 * reads as a chart that just started rather than a missing feature. When the
 * source publishes backward-looking averages (Cardmarket 1/7/30-day via
 * pokemontcg.io) they're shown as a trend strip under the chart — real
 * history from day one.
 */

export interface Point { day: string; price: number }
export interface Series {
  variant: string;
  source: string;
  currency: string;
  points: Point[];
}

type Range = 7 | 30 | 90 | 365 | 0;
const RANGES: { value: Range; label: string }[] = [
  { value: 7, label: "1W" },
  { value: 30, label: "1M" },
  { value: 90, label: "3M" },
  { value: 365, label: "1Y" },
  { value: 0, label: "All" },
];

export interface TrendAverages {
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  currency: Currency;
  source: string;
}

interface Props {
  cardId: string;
  /** The variant the shown quote uses ("holofoil", "nonfoil"…) — chart that series first. */
  preferVariant?: string | null;
  /** Backward-looking averages from the price source, if it publishes them. */
  trend?: TrendAverages | null;
  /** Tighter layout for the editor's market panel. */
  compact?: boolean;
  className?: string;
  /**
   * Rescale every plotted price (graded slab or non-NM condition estimate):
   * the raw series' shape is real demand signal, but its altitude is the NM
   * ungraded market — a PSA 10 or LP copy tracks the same curve at a
   * different level. 1/undefined = raw. Pass scaleLabel ("PSA 10 est.") so
   * the chart says the numbers are derived; the source-average strip is
   * hidden while scaled (those figures are raw and would contradict it).
   */
  scale?: number | null;
  scaleLabel?: string | null;
}

/**
 * The source-published averages for a card, if any (Cardmarket via
 * pokemontcg.io). Sanitized here — the display side — because cached price
 * rows predate the fetch-time guard in lib/tcg.ts: Cardmarket's product
 * averages sometimes blend 1st Edition / graded sales (Base Set Charizard's
 * 1d was €14,950 next to an $855 TCGplayer market), and one absurd figure
 * discredits the whole panel. The strip is dropped entirely when its 30d
 * baseline is >4x the best USD market; 1d/7d values >3x off that baseline
 * are hidden individually.
 */
export function cardTrend(card: Pick<PokemonCard, "prices">): TrendAverages | null {
  const p = card.prices.find((x) => x.trend && (x.trend.avg30 || x.trend.avg7 || x.trend.avg1));
  if (!p?.trend) return null;
  const usdMarket = card.prices.reduce<number | null>(
    (best, x) =>
      x.currency === "USD" && x.market != null && (best == null || x.market > best)
        ? x.market
        : best,
    null,
  );
  const base = p.trend.avg30 ?? p.trend.avg7;
  if (base != null && usdMarket != null && base > usdMarket * 4) return null;
  const steady = (v: number | null) =>
    v == null ? null : base != null && (v > base * 3 || v < base / 3) ? null : v;
  return {
    avg1: steady(p.trend.avg1),
    avg7: steady(p.trend.avg7),
    avg30: p.trend.avg30 ?? null,
    currency: p.currency,
    source: p.source,
  };
}

const cache = new Map<string, Series[]>();

/** Fetches (and memoizes per page) every series we hold for a card. Shared with PriceSparkline. */
export async function loadSeries(cardId: string): Promise<Series[]> {
  const hit = cache.get(cardId);
  if (hit) return hit;
  const res = await fetch(apiPath(`/api/price-history?cardId=${encodeURIComponent(cardId)}`));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { series: Series[] };
  cache.set(cardId, data.series);
  return data.series;
}

export function pickSeries(all: Series[], prefer: string | null | undefined): Series | null {
  if (all.length === 0) return null;
  const usd = all.filter((s) => s.currency === "USD");
  const pool = usd.length ? usd : all;
  const byPref = prefer ? pool.filter((s) => s.variant === prefer) : [];
  const ranked = (byPref.length ? byPref : pool)
    .slice()
    .sort((a, b) => b.points.length - a.points.length || (a.source === "tcgplayer" ? -1 : 1));
  return ranked[0] ?? null;
}

/**
 * The most recent recorded point for a card (preferring `variant`), from the
 * same fetch/cache the chart uses — lets the Market panel's TCGplayer tile
 * fall back to yesterday's recorded price when the live lookup fails
 * (pokemontcg.io drops about half its requests).
 */
export function useLastRecordedPrice(cardId: string, variant?: string | null) {
  const [state, setState] = useState<{ id: string; point: { price: number; day: string; variant: string; source: string; currency: Currency } | null }>({ id: "", point: null });
  useEffect(() => {
    if (!cardId) return; // caller has no catalogue card (hook-order placeholder)
    let alive = true;
    loadSeries(cardId)
      .then((all) => {
        if (!alive) return;
        const s = pickSeries(all, variant);
        const last = s?.points[s.points.length - 1];
        setState({ id: cardId, point: last && s ? { price: last.price, day: last.day, variant: s.variant, source: s.source, currency: s.currency as Currency } : null });
      })
      .catch(() => { if (alive) setState({ id: cardId, point: null }); });
    return () => { alive = false; };
  }, [cardId, variant]);
  return state.id === cardId ? state.point : null;
}

const dayMs = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
function shortDay(day: string, withYear = false): string {
  return new Date(parseDay(day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "2-digit" } : {}),
    timeZone: "UTC",
  });
}
function sourceLabel(s: string): string {
  return s === "tcgplayer" ? "TCGplayer" : s === "cardmarket" ? "Cardmarket" : s;
}
/** Axis-friendly price: whole dollars above $100, cents below. */
function axisMoney(v: number, currency: Currency): string {
  const sym = currency === "EUR" ? "€" : "$";
  if (v >= 1000) return `${sym}${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  if (v >= 100) return `${sym}${Math.round(v)}`;
  return `${sym}${v.toFixed(2)}`;
}
/** "Nice" tick step so axis labels land on round numbers. */
function niceStep(range: number, target = 4): number {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

const MONO = "var(--font-geist-mono), ui-monospace, monospace";

export default function PriceHistoryChart({ cardId, preferVariant, trend, compact = false, className = "", scale, scaleLabel }: Props) {
  const [loadedForFactor, setLoadedForFactor] = useState<Series[] | null>(null);
  // A REAL series at the preferred variant (a recorded graded curve) beats
  // any rescaled estimate: when the picked series matches preferVariant
  // exactly, the data is already at the right altitude — no scaling, and the
  // chip drops "est.".
  const exactVariant = Boolean(
    preferVariant && loadedForFactor && pickSeries(loadedForFactor, preferVariant)?.variant === preferVariant,
  );
  const requestedFactor = scale && scale > 0 && scale !== 1 ? scale : 1;
  const targetFactor = exactVariant ? 1 : requestedFactor;
  // Ease the curve between altitudes instead of teleporting: tween the scale
  // factor over ~350ms whenever it changes (grade flips felt laggy AND
  // jumpy — the glide makes the change read as one motion).
  const [factor, setFactor] = useState(targetFactor);
  const tweenRef = useRef<number | null>(null);
  useEffect(() => {
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
    setFactor((from) => {
      if (from === targetFactor) return from;
      // Motion policy: reduced-motion users get the new altitude immediately.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return targetFactor;
      const t0 = performance.now();
      const DURATION = 350;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / DURATION);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        setFactor(from + (targetFactor - from) * eased);
        if (t < 1) tweenRef.current = requestAnimationFrame(step);
      };
      tweenRef.current = requestAnimationFrame(step);
      return from;
    });
    return () => { if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFactor]);
  const scaled = targetFactor !== 1;
  if (scaled || exactVariant) trend = null; // raw source averages would contradict a scaled or graded curve
  const [range, setRange] = useState<Range>(90);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Keyed by cardId so a re-open of another card starts from the loading state.
  const [loaded, setLoaded] = useState<{ id: string; series: Series[] | null; failed: boolean }>({ id: "", series: null, failed: false });
  useEffect(() => {
    let alive = true;
    loadSeries(cardId)
      .then((s) => { if (alive) { setLoaded({ id: cardId, series: s, failed: false }); setLoadedForFactor(s); } })
      .catch(() => { if (alive) { setLoaded({ id: cardId, series: null, failed: true }); setLoadedForFactor(null); } });
    return () => { alive = false; };
  }, [cardId]);
  const all = loaded.id === cardId ? loaded.series : null;
  const failed = loaded.id === cardId && loaded.failed;

  const series = useMemo(() => (all ? pickSeries(all, preferVariant) : null), [all, preferVariant]);
  const currency = (series?.currency ?? "USD") as Currency;

  const [now] = useState(() => Date.now());
  const shown = useMemo(() => {
    if (!series) return [];
    const pts = range === 0 ? series.points : (() => {
      const cutoff = now - range * dayMs;
      const inRange = series.points.filter((p) => parseDay(p.day) >= cutoff);
      // A range with nothing in it (young series, "1Y") falls back to everything.
      return inRange.length >= 1 ? inRange : series.points;
    })();
    return factor === 1 ? pts : pts.map((p) => ({ ...p, price: Math.round(p.price * factor * 100) / 100 }));
  }, [series, range, now, factor]);

  // Width follows the container so text keeps its aspect; height is fixed.
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(360);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const initial = Math.round(el.getBoundingClientRect().width);
    if (initial > 0) setW(initial);
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = compact ? 150 : 200;
  const PAD = useMemo(() => ({ l: 8, r: 52, t: 12, b: 22 }), []);

  const geo = useMemo(() => {
    if (shown.length === 0) return null;
    const single = shown.length === 1;
    // A single point is drawn as a flat line across the last 7 days.
    const xs = single
      ? [parseDay(shown[0].day) - 7 * dayMs, parseDay(shown[0].day)]
      : shown.map((p) => parseDay(p.day));
    const ys = single ? [shown[0].price, shown[0].price] : shown.map((p) => p.price);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { lo *= 0.92; hi *= 1.08; }
    const span = hi - lo;
    lo -= span * 0.1; hi += span * 0.1;
    if (lo < 0) lo = 0;
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b;
    const sx = (x: number) => PAD.l + ((x - x0) / Math.max(1, x1 - x0)) * plotW;
    const sy = (y: number) => PAD.t + (1 - (y - lo) / (hi - lo)) * plotH;
    const pts = xs.map((x, i) => ({ x: sx(x), y: sy(ys[i]), p: shown[single ? 0 : i], t: x }));
    const d = pts.map((q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
    const base = (H - PAD.b).toFixed(1);
    const area = `${d} L${pts[pts.length - 1].x.toFixed(1)},${base} L${pts[0].x.toFixed(1)},${base} Z`;
    let minI = 0, maxI = 0;
    if (!single) ys.forEach((y, i) => { if (y < ys[minI]) minI = i; if (y > ys[maxI]) maxI = i; });
    // Price gridlines on round numbers.
    const step = niceStep(hi - lo);
    const yTicks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) yTicks.push(v);
    // Date ticks: ~4 across, at day boundaries.
    const days = Math.max(1, Math.round((x1 - x0) / dayMs));
    const every = Math.max(1, Math.round(days / 4));
    const xTicks: number[] = [];
    for (let t = x0; t <= x1; t += every * dayMs) xTicks.push(t);
    if (xTicks[xTicks.length - 1] < x1 - (every * dayMs) / 2) xTicks.push(x1);
    return { pts, d, area, minI, maxI, single, sx, sy, yTicks, xTicks };
  }, [shown, W, H, PAD]);

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
  const changeAbs = first && last ? last.price - first.price : null;
  const changePct = first && last && first.price > 0 ? ((last.price - first.price) / first.price) * 100 : null;
  const up = (changeAbs ?? 0) >= 0;
  const stroke = up ? "#34d399" : "#f87171"; // emerald-400 / red-400 — stock convention
  const rangeLo = geo && !geo.single ? shown[geo.minI].price : null;
  const rangeHi = geo && !geo.single ? shown[geo.maxI].price : null;
  const gradId = `ph-fill-${cardId.replace(/[^a-z0-9]/gi, "")}`;
  const label = compact ? "text-[10px]" : "text-[11px]";
  const hovered = hover !== null && geo ? geo.pts[hover] : null;
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? "";

  // Trend strip (Cardmarket averages) — direction over the last month.
  const trendPct =
    trend && trend.avg7 && trend.avg30 && trend.avg30 > 0
      ? ((trend.avg7 - trend.avg30) / trend.avg30) * 100
      : null;

  return (
    <section className={`rounded-2xl border border-edge bg-surface-1 ${compact ? "p-3" : "p-4"} ${className}`} aria-label="Price history">
      {/* Quote header */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <div className={`flex items-baseline gap-2 ${label} text-zinc-500`}>
            <span className={`${compact ? "text-xs" : "text-sm"} font-medium text-zinc-200`}>Price history</span>
            {series && (
              <span>{sourceLabel(series.source)}{series.variant && series.variant !== "normal" && series.variant !== "average" ? ` · ${series.variant}` : ""}</span>
            )}
            {scaleLabel && (scaled || exactVariant) && (
              <span className="rounded-full bg-sky-400/10 px-2 py-0.5 font-medium text-sky-300">
                {exactVariant ? scaleLabel.replace(/ est\.$/, " (recorded)") : scaleLabel}
              </span>
            )}
          </div>
          {last && (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className={`font-display ${compact ? "text-xl" : "text-2xl"} font-semibold tabular-nums text-white`}>
                {formatMoney(hovered ? hovered.p.price : last.price, currency)}
              </span>
              {hovered ? (
                <span className={`${label} text-zinc-400`}>{shortDay(hovered.p.day, true)}</span>
              ) : changeAbs !== null && shown.length > 1 ? (
                <span className={`${label} font-medium tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
                  {up ? "▲" : "▼"} {formatMoney(Math.abs(changeAbs), currency)} ({Math.abs(changePct ?? 0).toFixed(1)}%)
                  <span className="ml-1 font-normal text-zinc-500">{rangeLabel === "All" ? "all time" : rangeLabel}</span>
                </span>
              ) : (
                <span className={`${label} text-zinc-500`}>first recorded {shortDay(last.day)}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 rounded-full bg-black/30 p-0.5" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r.value}
              role="tab"
              aria-selected={range === r.value}
              onClick={() => { setRange(r.value); setHover(null); }}
              className={`rounded-full px-2 py-0.5 ${label} font-medium transition ${
                range === r.value ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={boxRef} className="w-full" />
      {failed && <p className={`mt-2 ${label} text-zinc-500`}>Couldn&apos;t load price history.</p>}
      {!failed && all === null && <div className="mt-2 animate-pulse rounded-lg bg-white/5" style={{ height: H }} aria-hidden />}
      {all !== null && !series && (
        <div className="mt-2 flex items-center justify-center rounded-lg border border-dashed border-edge" style={{ height: H }}>
          <p className={`${label} text-zinc-500`}>No price recorded for this card yet — the first point lands on its next price check.</p>
        </div>
      )}

      {geo && first && last && (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="mt-2 block w-full touch-none select-none"
            style={{ height: H }}
            role="img"
            aria-label={
              geo.single
                ? `One price recorded so far: ${formatMoney(last.price, currency)} on ${shortDay(last.day)}`
                : `Price from ${formatMoney(first.price, currency)} on ${shortDay(first.day)} to ${formatMoney(last.price, currency)} on ${shortDay(last.day)}`
            }
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* price gridlines + right-hand axis labels */}
            {geo.yTicks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={geo.sy(v)} y2={geo.sy(v)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
                <text x={W - PAD.r + 6} y={geo.sy(v) + 3} fontSize="10" fill="rgb(113 113 122)" fontFamily={MONO}>
                  {axisMoney(v, currency)}
                </text>
              </g>
            ))}
            {/* date ticks */}
            {geo.xTicks.map((t, i) => {
              const x = geo.sx(t);
              const anchor = i === 0 ? "start" : i === geo.xTicks.length - 1 ? "end" : "middle";
              return (
                <text key={t} x={x} y={H - 6} fontSize="9" fill="rgb(113 113 122)" textAnchor={anchor}>
                  {shortDay(new Date(t).toISOString().slice(0, 10))}
                </text>
              );
            })}
            {geo.single ? (
              <>
                <line x1={geo.pts[0].x} x2={geo.pts[1].x} y1={geo.pts[0].y} y2={geo.pts[1].y} stroke={stroke} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
                <circle cx={geo.pts[1].x} cy={geo.pts[1].y} r="4" fill={stroke} stroke="#08090d" strokeWidth="2" />
                <text x={geo.pts[1].x - 8} y={geo.pts[1].y - 9} textAnchor="end" fontSize="10" fill="rgb(212 212 216)" fontFamily={MONO}>
                  {formatMoney(last.price, currency)} · today
                </text>
              </>
            ) : (
              <>
                <path d={geo.area} fill={`url(#${gradId})`} />
                <path d={geo.d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {/* min / max direct labels — the two numbers a seller wants */}
                {[geo.maxI, geo.minI].map((i, k) => {
                  const q = geo.pts[i];
                  const isMax = k === 0;
                  const anchor = q.x > W - PAD.r - 60 ? "end" : q.x < PAD.l + 60 ? "start" : "middle";
                  return (
                    <g key={isMax ? "max" : "min"}>
                      <circle cx={q.x} cy={q.y} r="3" fill={stroke} stroke="#08090d" strokeWidth="2" />
                      <text x={q.x} y={isMax ? q.y - 7 : q.y + 13} textAnchor={anchor} fontSize="10" fill="rgb(212 212 216)" fontFamily={MONO}>
                        {formatMoney(q.p.price, currency)}
                      </text>
                    </g>
                  );
                })}
                {/* last price level line + marker, like a quote screen */}
                <line x1={PAD.l} x2={W - PAD.r} y1={geo.pts[geo.pts.length - 1].y} y2={geo.pts[geo.pts.length - 1].y} stroke={stroke} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 4" />
                <circle cx={geo.pts[geo.pts.length - 1].x} cy={geo.pts[geo.pts.length - 1].y} r="3.5" fill={stroke} stroke="#08090d" strokeWidth="2" />
              </>
            )}
            {hovered && !geo.single && (
              <g pointerEvents="none">
                <line x1={hovered.x} x2={hovered.x} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                <circle cx={hovered.x} cy={hovered.y} r="4.5" fill={stroke} stroke="#08090d" strokeWidth="2" />
                {(() => {
                  const text = `${shortDay(hovered.p.day)}  ${formatMoney(hovered.p.price, currency)}`;
                  const w = text.length * 6 + 12;
                  const x = Math.min(Math.max(hovered.x - w / 2, PAD.l), W - PAD.r - w);
                  const y = Math.max(PAD.t, hovered.y - 30);
                  return (
                    <g>
                      <rect x={x} y={y} width={w} height={18} rx="4" fill="#15161c" stroke="rgba(255,255,255,0.12)" />
                      <text x={x + w / 2} y={y + 12.5} textAnchor="middle" fontSize="10" fill="rgb(228 228 231)" fontFamily={MONO}>
                        {text}
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}
          </svg>

          <div className={`mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${label} text-zinc-500`}>
            <span className="tabular-nums">
              {geo.single
                ? `Tracking since ${shortDay(last.day)} — a new point lands every day`
                : `${rangeLabel === "All" ? "All time" : rangeLabel} low ${formatMoney(rangeLo, currency)} · high ${formatMoney(rangeHi, currency)} · ${shown.length} days`}
            </span>
            {series && series.points.length > 1 && (
              <span>{shortDay(series.points[0].day, true)} → {shortDay(series.points[series.points.length - 1].day, true)}</span>
            )}
          </div>
        </>
      )}

      {/* Backward-looking averages from the source (Cardmarket): real trend on day one. */}
      {trend && (trend.avg30 || trend.avg7 || trend.avg1) && (
        <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-black/25 px-2.5 py-1.5 ${label} text-zinc-400`}>
          <span className="text-zinc-500">{sourceLabel(trend.source)} averages</span>
          {trend.avg30 != null && <span>30d <span className="tabular-nums text-zinc-200">{formatMoney(trend.avg30, trend.currency)}</span></span>}
          {trend.avg7 != null && <span>7d <span className="tabular-nums text-zinc-200">{formatMoney(trend.avg7, trend.currency)}</span></span>}
          {trend.avg1 != null && <span>1d <span className="tabular-nums text-zinc-200">{formatMoney(trend.avg1, trend.currency)}</span></span>}
          {trendPct !== null && (
            <span className={`ml-auto font-medium tabular-nums ${trendPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {trendPct >= 0 ? "▲" : "▼"} {Math.abs(trendPct).toFixed(1)}% <span className="font-normal text-zinc-500">7d vs 30d</span>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
