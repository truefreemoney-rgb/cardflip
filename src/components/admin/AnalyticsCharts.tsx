"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

/**
 * /admin/analytics charts (10-07, Chris: "make it look amazing"). The headline
 * tiles ARE the selector: tap one and the big chart below draws that metric,
 * this period as a solid line over an area fill, the period before as a faint
 * dotted line behind it, with a crosshair tooltip (hover on desktop, tap or drag
 * on a phone). Secondary metrics are compact tiles with sparklines that can be
 * charted the same way. Inline SVG, measured to real pixels so labels stay crisp
 * at 375 px. Static by design (Chris's Windows has animations off).
 */

export interface ChartMetric {
  id: string;
  label: string;
  /** CSS color (hex or var()). */
  color: string;
  usd?: boolean;
  /** Down is good (errors, spend). */
  invert?: boolean;
  total: number;
  prior: number;
  keys: string[];
  values: number[];
  priorValues: number[];
  hourly: boolean;
  /** Small grey line under the tile value. */
  note?: string;
  /** Full row in the headline grid (Total income). */
  wide?: boolean;
}

const STORE_KEY = "cardflip.analyticsMetric";
const noSubscribe = () => () => {};
function readSaved(): string | null {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

export default function AnalyticsCharts({ headline, secondary, priorLabel }: { headline: ChartMetric[]; secondary: ChartMetric[]; priorLabel: string }) {
  const all = useMemo(() => [...headline, ...secondary], [headline, secondary]);
  // The last tile picked is remembered per browser; the server render (and a blocked storage) starts on the first.
  const saved = useSyncExternalStore(noSubscribe, readSaved, () => null);
  const [picked, setPicked] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const pick = (id: string) => {
    setPicked(id);
    try { localStorage.setItem(STORE_KEY, id); } catch { /* fine */ }
    // On a phone the chart sits below the tiles: bring it up if it is off screen.
    const el = chartRef.current;
    if (el && el.getBoundingClientRect().bottom > window.innerHeight) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
    }
  };
  const sel = picked ?? saved;
  const current = all.find((m) => m.id === sel) ?? headline[0];

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        {headline.map((m) => (
          <MetricTile key={m.id} m={m} active={m.id === current.id} onPick={pick} big />
        ))}
      </div>

      <div ref={chartRef} className="scroll-mb-20 sm:scroll-mb-4">
        {current && <BigChart m={current} priorLabel={priorLabel} />}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-zinc-500">More numbers</h2>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {secondary.map((m) => (
          <MetricTile key={m.id} m={m} active={m.id === current.id} onPick={pick} />
        ))}
      </div>
    </>
  );
}

/* ---------- formatting ---------- */

function fmt(v: number, usd?: boolean): string {
  if (usd) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (Math.round(v * 100) / 100).toLocaleString("en-US");
}
/** Axis labels: short ($1.2k, 3.4k). */
function short(v: number, usd?: boolean): string {
  const p = usd ? "$" : "";
  if (v >= 1000) return `${p}${(v / 1000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  if (usd && v > 0 && v < 10) return `${p}${v.toFixed(v < 1 ? 2 : 1).replace(/\.0+$/, "")}`;
  return `${p}${Math.round(v * 100) / 100}`;
}
function dayLabel(k: string): string {
  return new Date(`${k.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function hourLabel(k: string): string {
  const h = Number(k.slice(11, 13));
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}
/** Tooltip time: "Oct 6, 3 PM to 4 PM ET" or "Tue, Oct 6". */
function whenLabel(k: string, hourly: boolean): string {
  if (!hourly) {
    return new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }
  const h = Number(k.slice(11, 13));
  return `${dayLabel(k)}, ${hourLabel(k)} to ${hourLabel(`${k.slice(0, 11)}${String((h + 1) % 24).padStart(2, "0")}`)} ET`;
}

function delta(cur: number, prior: number, invert?: boolean): { text: string; tone: string } {
  if (!prior) return cur ? { text: "new", tone: invert ? "text-rose-400" : "text-emerald-400" } : { text: "—", tone: "text-zinc-600" };
  const pct = Math.round(((cur - prior) / prior) * 100);
  if (pct === 0) return { text: "flat", tone: "text-zinc-500" };
  const good = invert ? pct < 0 : pct > 0;
  return { text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`, tone: good ? "text-emerald-400" : "text-rose-400" };
}

/* ---------- geometry ---------- */

type Pt = [number, number];

/** Monotone cubic through the points (never overshoots below zero between buckets). */
function smoothPath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/** A round axis top and step: about 4 gridlines; whole numbers for counts (no "0.25 sign-ups"). */
function niceScale(max: number, usd?: boolean): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  if (!usd) step = Math.max(1, Math.ceil(step));
  return { top: step * Math.ceil(max / step), step };
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ---------- tiles ---------- */

function MetricTile({ m, active, onPick, big = false }: { m: ChartMetric; active: boolean; onPick: (id: string) => void; big?: boolean }) {
  const d = delta(m.total, m.prior, m.invert);
  return (
    <button
      type="button"
      onClick={() => onPick(m.id)}
      aria-pressed={active}
      className={`group relative overflow-hidden rounded-2xl border bg-surface-1 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        big ? "p-3 sm:p-3.5" : "p-3"
      } ${m.wide ? "col-span-2 md:col-span-3 xl:col-span-6" : ""} ${active ? "border-transparent bg-surface-2" : "border-edge"}`}
      style={active ? { boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${m.color} 70%, transparent), 0 8px 28px -12px color-mix(in srgb, ${m.color} 60%, transparent)` } : undefined}
    >
      {active && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: m.color }} />}
      <div className={m.wide ? "md:flex md:items-end md:justify-between md:gap-4" : ""}>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-xs text-zinc-400">
            <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: m.color }} />
            {m.label}
          </p>
          <p className={`font-display font-semibold tabular-nums leading-tight ${big ? "mt-0.5 text-xl sm:mt-1 sm:text-2xl" : "mt-0.5 text-lg"} ${m.usd && m.total > 0 ? "text-emerald-400" : "text-white"}`}>
            {fmt(m.total, m.usd)}
          </p>
          <p className="mt-0.5 truncate text-[11px] tabular-nums">
            <span className={d.tone}>{d.text}</span>
            {m.prior > 0 && <span className="text-zinc-600"> · {fmt(m.prior, m.usd)} before</span>}
            {m.note && <span className="text-zinc-500"> · {m.note}</span>}
          </p>
        </div>
        <Sparkline m={m} className={m.wide ? "mt-1.5 h-7 w-full md:mt-0 md:h-10 md:w-1/2 md:max-w-md md:shrink-0" : `mt-1.5 w-full ${big ? "h-7 sm:h-9" : "h-6"}`} />
      </div>
    </button>
  );
}

function Sparkline({ m, className }: { m: ChartMetric; className: string }) {
  const id = useId().replace(/:/g, "");
  const W = 100;
  const H = 30;
  const max = Math.max(...m.values, ...m.priorValues, 0);
  const n = m.values.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => (max > 0 ? H - 2 - (v / max) * (H - 4) : H - 2);
  const pts: Pt[] = m.values.map((v, i) => [x(i), y(v)]);
  const prior: Pt[] = m.priorValues.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`block ${className}`} aria-hidden>
      <defs>
        <linearGradient id={`sp${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: m.color, stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: m.color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {max > 0 && n > 1 && (
        <path d={smoothPath(prior)} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1} strokeDasharray="2 2.5" vectorEffect="non-scaling-stroke" />
      )}
      {n > 1 && <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#sp${id})`} />}
      <path d={n > 1 ? line : `M0,${y(m.values[0] ?? 0)} L${W},${y(m.values[0] ?? 0)}`} fill="none" stroke={m.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ---------- the big chart ---------- */

function BigChart({ m, priorLabel }: { m: ChartMetric; priorLabel: string }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  // Tagged with the metric, so switching tiles drops the old crosshair.
  const [hoverAt, setHoverAt] = useState<{ id: string; i: number } | null>(null);
  const hover = hoverAt?.id === m.id ? hoverAt.i : null;
  const setHover = (i: number | null) => setHoverAt(i === null ? null : { id: m.id, i });
  const gid = useId().replace(/:/g, "");

  const narrow = width < 520;
  const H = narrow ? 210 : 280;
  const pad = { l: narrow ? 34 : 44, r: 12, t: 14, b: 26 };
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = H - pad.t - pad.b;
  const n = m.values.length;
  const { top, step } = niceScale(Math.max(...m.values, ...m.priorValues, 0), m.usd);
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const pts: Pt[] = m.values.map((v, i) => [x(i), y(v)]);
  const prior: Pt[] = m.priorValues.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);

  // X labels: as many as fit (~70 px each), always the first and last bucket.
  const fit = Math.max(2, Math.floor(iw / (narrow ? 64 : 80)));
  const every = Math.max(1, Math.ceil((n - 1) / (fit - 1)));
  const multiDay = m.hourly && n > 0 && m.keys[0].slice(0, 10) !== m.keys[n - 1].slice(0, 10);
  const xLabel = (k: string) => (m.hourly ? (multiDay && k.slice(11, 13) === "00" ? dayLabel(k) : hourLabel(k)) : dayLabel(k));
  const xIdx: number[] = [];
  for (let i = 0; i < n; i += every) xIdx.push(i);
  if (n > 1 && xIdx[xIdx.length - 1] !== n - 1) {
    if (n - 1 - xIdx[xIdx.length - 1] < every * 0.6) xIdx.pop();
    xIdx.push(n - 1);
  }

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = n <= 1 ? 0 : Math.round((px / r.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const empty = m.total === 0 && m.prior === 0 && m.values.every((v) => v === 0);
  const d = delta(m.total, m.prior, m.invert);
  const hv = hover === null ? null : { k: m.keys[hover], v: m.values[hover] ?? 0, p: m.priorValues[hover] ?? 0, x: x(hover), y: y(m.values[hover] ?? 0) };
  const tipW = 168;
  const tipLeft = hv ? Math.min(Math.max(hv.x - tipW / 2, 4), Math.max(4, width - tipW - 4)) : 0;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-edge bg-surface-1">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-4 pt-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-300">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: m.color, boxShadow: `0 0 10px ${m.color}` }} />
            {m.label}
          </p>
          <p className="mt-0.5 flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold tabular-nums text-white">{fmt(m.total, m.usd)}</span>
            <span className={`text-xs tabular-nums ${d.tone}`}>{d.text}</span>
          </p>
        </div>
        <div className="flex items-center gap-3 pb-1 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden><line x1="0" x2="16" y1="3" y2="3" stroke={m.color} strokeWidth="2" strokeLinecap="round" /></svg>
            This period
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden><line x1="0" x2="16" y1="3" y2="3" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="2 3" /></svg>
            {priorLabel.charAt(0).toUpperCase() + priorLabel.slice(1)} · {fmt(m.prior, m.usd)}
          </span>
        </div>
      </div>

      <div ref={wrap} className="relative mt-2 select-none" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} className="block" role="img" aria-label={`${m.label}: ${fmt(m.total, m.usd)} this period, ${fmt(m.prior, m.usd)} ${priorLabel}`}>
            <defs>
              <linearGradient id={`area${gid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: m.color, stopOpacity: 0.32 }} />
                <stop offset="70%" style={{ stopColor: m.color, stopOpacity: 0.06 }} />
                <stop offset="100%" style={{ stopColor: m.color, stopOpacity: 0 }} />
              </linearGradient>
              <filter id={`glow${gid}`} x="-10%" y="-30%" width="120%" height="160%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>

            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"} />
                <text x={pad.l - 8} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="rgb(113 113 122)" className="tabular-nums">{short(v, m.usd)}</text>
              </g>
            ))}
            {xIdx.map((i) => (
              <text key={i} x={x(i)} y={H - 8} fontSize="10" fill="rgb(113 113 122)"
                textAnchor={n <= 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
                {xLabel(m.keys[i])}
              </text>
            ))}

            {!empty && n > 1 && (
              <path d={smoothPath(prior)} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} strokeDasharray="3 4" strokeLinecap="round" />
            )}
            {!empty && n > 1 && <path d={`${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#area${gid})`} />}
            {!empty && n > 1 && <path d={line} fill="none" stroke={m.color} strokeWidth={5} opacity={0.35} filter={`url(#glow${gid})`} />}
            {!empty && n > 1 && <path d={line} fill="none" stroke={m.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />}
            {!empty && n === 1 && <circle cx={x(0)} cy={y(m.values[0])} r={5} fill={m.color} />}
            {/* The latest bucket: a ringed dot, so "now" reads at a glance. */}
            {!empty && n > 1 && hover === null && (
              <>
                <circle cx={x(n - 1)} cy={y(m.values[n - 1])} r={7} fill={m.color} opacity={0.18} />
                <circle cx={x(n - 1)} cy={y(m.values[n - 1])} r={3.5} fill={m.color} stroke="#0a0b11" strokeWidth={1.5} />
              </>
            )}

            {hv && !empty && (
              <g pointerEvents="none">
                <line x1={hv.x} x2={hv.x} y1={pad.t} y2={pad.t + ih} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 3" />
                <circle cx={hv.x} cy={y(hv.p)} r={3} fill="#0a0b11" stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} />
                <circle cx={hv.x} cy={hv.y} r={8} fill={m.color} opacity={0.2} />
                <circle cx={hv.x} cy={hv.y} r={4} fill={m.color} stroke="#0a0b11" strokeWidth={2} />
              </g>
            )}

            <rect x={pad.l} y={0} width={iw} height={H} fill="transparent" style={{ touchAction: "pan-y", cursor: "crosshair" }}
              onPointerMove={onMove} onPointerDown={onMove}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }} />
          </svg>
        )}

        {empty && width > 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6 text-xs text-zinc-500">Nothing in this range yet.</p>
        )}

        {hv && !empty && (
          <div className="pointer-events-none absolute top-1 rounded-xl border border-edge-strong bg-[#11131c]/95 px-3 py-2 text-xs shadow-xl shadow-black/50 backdrop-blur"
            style={{ left: tipLeft, width: tipW }}>
            <p className="text-[11px] text-zinc-400">{whenLabel(hv.k, m.hourly)}</p>
            <p className="mt-0.5 font-display text-lg font-semibold tabular-nums text-white">{fmt(hv.v, m.usd)}</p>
            <p className="tabular-nums text-zinc-500">Before: <span className="text-zinc-300">{fmt(hv.p, m.usd)}</span></p>
          </div>
        )}
      </div>
    </div>
  );
}
