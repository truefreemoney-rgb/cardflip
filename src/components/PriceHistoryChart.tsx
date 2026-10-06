"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/listing";
import type { Currency } from "@/lib/types";
import { PRICE_FLAG_NOTE, priceStaleNote } from "@/lib/priceFlag";
import { cache, loadSeries, pickSeries, type Series, type TrendAverages } from "@/lib/client/priceHistoryData";

// Compatibility: callers import the data helpers from here; they live in lib/client/priceHistoryData.ts so light users skip the chart code.
export { cardTrend, loadSeries, pickSeries, lastRecordedPoint, useLastRecordedPrice } from "@/lib/client/priceHistoryData";
export type { Point, Series, RecordedPoint, TrendAverages } from "@/lib/client/priceHistoryData";
import RangePills, { rangeShort, rangeWindow, type RangeChoice } from "@/components/RangePills";

/**
 * A card's price over time, drawn like a stock chart: quote header (current
 * price, change for the selected range), the site's range picker (Dates, 24h,
 * 7 days, 30 days, 90 days: components/RangePills.tsx), price axis with
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


interface Props {
  cardId: string;
  /**
   * The card's series, already read on the server (the public card pages, 09-30).
   * The chart draws from them on the first, server-rendered pass — real SVG in
   * the HTML for crawlers — and never calls /api/price-history. Each series
   * carries the price guard's `untrusted` verdict, exactly as that route serves
   * it. Absent = the old behaviour: fetch on mount.
   */
  initialSeries?: Series[] | null;
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


const dayMs = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
function shortDay(day: string, withYear = false): string {
  // en-US, not the viewer's locale: the same text on the server and in the browser (a server-rendered chart must hydrate), and the site is American.
  return new Date(parseDay(day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "2-digit" } : {}),
    timeZone: "UTC",
  });
}
function sourceLabel(s: string): string {
  return s === "tcgplayer" ? "Market" : s === "cardmarket" ? "Cardmarket" : s === "cardmarket-converted" ? "Cardmarket (converted from €)" : s === "cardtrader" ? "CardTrader (listings)" : s;
}
/** Axis-friendly price: whole dollars above $100, cents below. */
function axisMoney(v: number, currency: Currency): string {
  const sym = currency === "EUR" ? "€" : "$";
  if (v >= 1000) return `${sym}${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  if (v >= 100) return `${sym}${Math.round(v)}`;
  return `${sym}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export default function PriceHistoryChart({ cardId, initialSeries, preferVariant, trend, compact = false, className = "", scale, scaleLabel }: Props) {
  const [loadedForFactor, setLoadedForFactor] = useState<Series[] | null>(initialSeries ?? null);
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
  }, [targetFactor]);
  const scaled = targetFactor !== 1;
  if (scaled || exactVariant) trend = null; // raw source averages would contradict a scaled or graded curve
  const [range, setRange] = useState<RangeChoice>({ preset: "90d" });
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Keyed by cardId so a re-open of another card starts from the loading state.
  // Server-provided series seed it, so the first render already has the data.
  const [loaded, setLoaded] = useState<{ id: string; series: Series[] | null; failed: boolean }>(() =>
    initialSeries ? { id: cardId, series: initialSeries, failed: false } : { id: "", series: null, failed: false },
  );
  useEffect(() => {
    let alive = true;
    // A stub card (detail view still resolving the printing) has no id yet:
    // stay in the loading state instead of a 400 + "Couldn't load" flash.
    if (!cardId) return;
    if (initialSeries) {
      // Already here: no request, and any other panel of this card on the page reads the same series.
      if (!cache.has(cardId)) cache.set(cardId, Promise.resolve(initialSeries));
      return;
    }
    loadSeries(cardId)
      .then((s) => { if (alive) { setLoaded({ id: cardId, series: s, failed: false }); setLoadedForFactor(s); } })
      .catch(() => { if (alive) { setLoaded({ id: cardId, series: null, failed: true }); setLoadedForFactor(null); } });
    return () => { alive = false; };
  }, [cardId, initialSeries]);
  const all = loaded.id === cardId ? loaded.series : null;
  const failed = loaded.id === cardId && loaded.failed;

  const series = useMemo(() => (all ? pickSeries(all, preferVariant) : null), [all, preferVariant]);
  const currency = (series?.currency ?? "USD") as Currency;

  // With server-provided series the ranges count back from the newest recorded day, not the clock: a page cached for
  // two days must draw the same chart on the server and in the browser (hydration) and "3M" still means the last 90 recorded days.
  const [now] = useState(() => {
    const newest = initialSeries ? Math.max(...initialSeries.map((s) => (s.points.length ? parseDay(s.points[s.points.length - 1].day) : NaN)).filter(Number.isFinite)) : NaN;
    return Number.isFinite(newest) ? newest : Date.now();
  });
  const shown = useMemo(() => {
    if (!series) return [];
    const pts = (() => {
      const w = rangeWindow(range, now);
      const inRange = series.points.filter((p) => parseDay(p.day) >= w.since && parseDay(p.day) <= w.until);
      // A range with nothing in it (a young series, dates before it began) falls back to everything.
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
  // The price guard: the history is still drawn, but its latest point is not presented as the card's price.
  const flagged = Boolean(series?.untrusted);
  const stroke = up ? "#34d399" : "#f87171"; // emerald-400 / red-400 — stock convention
  const rangeLo = geo && !geo.single ? shown[geo.minI].price : null;
  const rangeHi = geo && !geo.single ? shown[geo.maxI].price : null;
  const gradId = `ph-fill-${cardId.replace(/[^a-z0-9]/gi, "")}`;
  const label = compact ? "text-[10px]" : "text-[11px]";
  const hovered = hover !== null && geo ? geo.pts[hover] : null;
  const rangeLabel = rangeShort(range);

  // Trend strip (Cardmarket averages) — direction over the last month.
  const trendPct =
    trend && trend.avg7 && trend.avg30 && trend.avg30 > 0
      ? ((trend.avg7 - trend.avg30) / trend.avg30) * 100
      : null;

  return (
    <section className={`@container rounded-2xl border border-edge bg-surface-1 ${compact ? "p-3" : "p-4"} ${className}`} aria-label="Price history">
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
              {flagged && !hovered ? (
                <span className={`${compact ? "text-xs" : "text-sm"} font-medium text-amber-300`}>{PRICE_FLAG_NOTE}</span>
              ) : (
                <span className={`font-display ${compact ? "text-xl" : "text-2xl"} font-semibold tabular-nums text-white`}>
                  {formatMoney(hovered ? hovered.p.price : last.price, currency)}
                </span>
              )}
              {hovered ? (
                <span className={`${label} text-zinc-400`}>{shortDay(hovered.p.day, true)}</span>
              ) : flagged ? null : changeAbs !== null && shown.length > 1 ? (
                <span className={`${label} font-medium tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
                  {up ? "▲" : "▼"} {formatMoney(Math.abs(changeAbs), currency)} ({Math.abs(changePct ?? 0).toFixed(1)}%)
                  <span className="ml-1 font-normal text-zinc-500">{rangeLabel === "All" ? "all time" : rangeLabel}</span>
                </span>
              ) : (
                <span className={`${label} text-zinc-500`}>first recorded {shortDay(last.day)}</span>
              )}
            </div>
          )}
          {/* The latest value has stood 45+ days (10-02): the number stands, this says how old it is. */}
          {last && !flagged && !hovered && series?.stale && (
            <p className={`${label} mt-0.5 text-zinc-400`}>{priceStaleNote(series.stale.days)}</p>
          )}
        </div>
        {/* The one date changer (Chris 10-02): Dates, 24h, 7 days, 30 days, 90 days. */}
        <RangePills value={range} onChange={(c) => { setRange(c); setHover(null); }} fit />
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
            className="mt-2 block w-full touch-pan-y select-none"
            style={{ height: H }}
            role="img"
            aria-label={
              flagged
                ? "Price history"
                : geo.single
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
                  {flagged ? "today" : `${formatMoney(last.price, currency)} · today`}
                </text>
              </>
            ) : (
              <>
                <path d={geo.area} fill={`url(#${gradId})`} />
                <path d={geo.d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {/* min / max direct labels — the two numbers a seller wants */}
                {[geo.maxI, geo.minI].map((i, k) => {
                  const q = geo.pts[i];
                  // A flagged series' latest point is not a price to print: its label is dropped, the dot stays.
                  const printed = !(flagged && i === geo.pts.length - 1);
                  const isMax = k === 0;
                  const anchor = q.x > W - PAD.r - 60 ? "end" : q.x < PAD.l + 60 ? "start" : "middle";
                  return (
                    <g key={isMax ? "max" : "min"}>
                      <circle cx={q.x} cy={q.y} r="3" fill={stroke} stroke="#08090d" strokeWidth="2" />
                      {printed && (
                        <text x={q.x} y={isMax ? q.y - 7 : q.y + 13} textAnchor={anchor} fontSize="10" fill="rgb(212 212 216)" fontFamily={MONO}>
                          {formatMoney(q.p.price, currency)}
                        </text>
                      )}
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
                  const text = flagged && hover === geo.pts.length - 1 ? shortDay(hovered.p.day) : `${shortDay(hovered.p.day)}  ${formatMoney(hovered.p.price, currency)}`;
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
                : flagged
                  ? `${rangeLabel === "All" ? "All time" : rangeLabel} · ${shown.length} days`
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
