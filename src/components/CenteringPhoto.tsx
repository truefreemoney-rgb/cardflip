"use client";

import { useEffect, useRef, useState } from "react";
import { checkCentering, type Centering } from "@/lib/centering";

/**
 * The match panel on the listing screen: the catalogue art and the seller's
 * photo as two equal 5:7 tiles in one surface, a corner label on each, and
 * the centering read as one line under both (09-28, Chris: the old
 * side-by-side with captions underneath "looked bad" on the phone — uneven
 * heights, tiny grey labels, a three-line failure note under one column).
 *
 * The centering check runs entirely in the browser off the scan photo: no
 * extra vision spend. Pokémon only (yellow border); other games get the
 * plain photo. The drawn box follows the measured inner edge of the border
 * and each side carries its share as a percent. When the border cannot be
 * measured the line says so; a number is never invented.
 */

const MAX_EDGE = 640;

/** A read is keyed by the photo it was made from; a new photo starts "working". */
type Read = { src: string; kind: "none" } | { src: string; kind: "done"; result: Centering };
type State = { kind: "off" } | { kind: "working" } | { kind: "none" } | { kind: "done"; result: Centering };

const tileClass = "relative aspect-[5/7] overflow-hidden rounded-xl bg-black/40";
const labelClass =
  "pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-200 backdrop-blur-sm";

/** The "Match" tile wrapper: whatever art (or placeholder) the editor has. */
export function MatchTile({ children }: { children: React.ReactNode }) {
  return (
    <div className={tileClass}>
      <span className={labelClass}>Match</span>
      {children}
    </div>
  );
}

export function MatchComparison({
  match,
  photoSrc,
  centering,
}: {
  match: React.ReactNode;
  /** The seller's photo; search-added cards have none. */
  photoSrc: string | null;
  /** Run the yellow-border centering read (Pokémon only). */
  centering: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const active = centering && Boolean(photoSrc);
  const state: State = !active
    ? { kind: "off" }
    : read && read.src === photoSrc
      ? read.kind === "done"
        ? { kind: "done", result: read.result }
        : { kind: "none" }
      : { kind: "working" };

  useEffect(() => {
    if (!centering || !photoSrc) return;
    const src = photoSrc;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const W = Math.max(1, Math.round(img.naturalWidth * scale));
      const H = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, W, H);
      let result: Centering | null = null;
      try {
        result = checkCentering(ctx.getImageData(0, 0, W, H));
      } catch {
        result = null;
      }
      if (!result) {
        setRead({ src, kind: "none" });
        return;
      }
      draw(ctx, result, W);
      setRead({ src, kind: "done", result });
    };
    img.onerror = () => {
      if (!cancelled) setRead({ src, kind: "none" });
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [photoSrc, centering]);

  const done = state.kind === "done" ? state.result : null;
  const tone = !done ? "text-zinc-500" : done.psaMax >= 9 ? "text-emerald-400" : done.psaMax >= 7 ? "text-amber-300" : "text-rose-400";
  const dot = !done ? "bg-zinc-600" : done.psaMax >= 9 ? "bg-emerald-400" : done.psaMax >= 7 ? "bg-amber-300" : "bg-rose-400";

  return (
    <div className={`w-full shrink-0 rounded-2xl border border-edge bg-surface-1 p-2 ${photoSrc ? "sm:w-[21rem]" : "sm:w-[10.5rem]"}`}>
      <div className={`grid gap-2 ${photoSrc ? "grid-cols-2" : "grid-cols-1"}`}>
        <MatchTile>{match}</MatchTile>
        {photoSrc && (
          <div className={tileClass}>
            <span className={labelClass}>{done ? "Centering" : "Your photo"}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoSrc}
              alt="The photo you uploaded"
              className={`absolute inset-0 h-full w-full object-contain ${done ? "invisible" : ""}`}
            />
            {/* The canvas holds the same photo with the centering box drawn
                on; same box, same object-fit, so it lands exactly over the
                img and the layout never changes. */}
            <canvas
              ref={canvasRef}
              aria-hidden={!done}
              className={`absolute inset-0 h-full w-full object-contain ${done ? "" : "hidden"}`}
            />
          </div>
        )}
      </div>
      {photoSrc && state.kind !== "off" && (
        <div className="mt-2 flex min-h-[1.25rem] items-center gap-2 px-1 pb-0.5 text-xs">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          {state.kind === "working" && <span className="text-zinc-500">Checking centering…</span>}
          {state.kind === "none" && (
            <span className="text-zinc-500">
              Centering not measured
              <span className="hidden min-[400px]:inline"> · keep the whole yellow border in frame</span>
            </span>
          )}
          {done && (
            <>
              <span className="font-display text-sm text-white">
                {done.horizontal} <span className="text-[11px] text-zinc-500">L/R</span>
              </span>
              <span className="font-display text-sm text-white">
                {done.vertical} <span className="text-[11px] text-zinc-500">T/B</span>
              </span>
              <span className={`ml-auto truncate ${tone}`} title={done.borders.clipped ? "Rough read: the border touches the photo edge" : undefined}>
                {done.verdict}
                {done.borders.clipped ? " (rough)" : ""}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, c: Centering, W: number) {
  const { outer, left, right, top, bottom } = c.borders;
  const lw = Math.max(1.5, W / 300);
  // Inner edge of the border: the box the artwork sits in.
  ctx.save();
  ctx.lineWidth = lw;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.setLineDash([lw * 3, lw * 3]);
  ctx.strokeRect(outer.x0 + left, outer.y0 + top, outer.x1 - outer.x0 - left - right, outer.y1 - outer.y0 - top - bottom);
  ctx.setLineDash([]);
  // Outer edge of the card, faint.
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(outer.x0, outer.y0, outer.x1 - outer.x0, outer.y1 - outer.y0);
  // Border share on each side.
  const font = Math.max(11, Math.round(W / 26));
  ctx.font = `600 ${font}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = (text: string, x: number, y: number) => {
    const w = ctx.measureText(text).width + font * 0.8;
    const h = font * 1.5;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x, y);
  };
  const pct = (n: number) => `${Math.round(n)}%`;
  const midX = (outer.x0 + outer.x1) / 2;
  const midY = (outer.y0 + outer.y1) / 2;
  label(pct(c.leftPct), outer.x0 + left + font * 1.6, midY);
  label(pct(100 - c.leftPct), outer.x1 - right - font * 1.6, midY);
  label(pct(c.topPct), midX, outer.y0 + top + font);
  label(pct(100 - c.topPct), midX, outer.y1 - bottom - font);
  ctx.restore();
}
