"use client";

import { useState } from "react";

/**
 * 30-day activity as thin bars — one hue, hover reveals the day's value.
 * Sized to its container via viewBox; no axes beyond a baseline and the
 * first/last dates (the total sits in the tile header).
 */
export default function ActivityBars({
  days,
  values,
  height = 64,
  color = "var(--color-brand-400)",
}: {
  days: string[];
  values: number[];
  height?: number;
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const H = height;
  const n = Math.max(1, values.length);
  const max = Math.max(1, ...values);
  const gap = 2;
  const bw = (W - gap * (n - 1)) / n;
  const label = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="block w-full" style={{ height: H + 14 }} role="img"
        aria-label={`Daily activity, last ${n} days, peak ${max}`}>
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 2 : 0, (v / max) * H);
          const x = i * (bw + gap);
          return (
            <g key={days[i]} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(2, bw / 2)} fill={color}
                opacity={hover === null || hover === i ? 0.9 : 0.4} />
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} stroke="rgba(255,255,255,0.08)" />
        <text x={0} y={H + 11} fontSize="8" fill="rgb(113 113 122)">{label(days[0] ?? "")}</text>
        <text x={W} y={H + 11} fontSize="8" fill="rgb(113 113 122)" textAnchor="end">{label(days[days.length - 1] ?? "")}</text>
      </svg>
      <div className="mt-1 h-4 text-[11px] text-zinc-400 tabular-nums" aria-live="polite">
        {hover !== null ? `${label(days[hover])} · ${values[hover]}` : ""}
      </div>
    </div>
  );
}
