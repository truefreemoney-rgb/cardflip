"use client";

import { useEffect, useRef, useState } from "react";
import { checkCentering, type Centering } from "@/lib/centering";

/**
 * The hero of the listing screen (09-28 makeover, Chris: the side-by-side
 * match/photo pair "looked messy" on the phone). One big card on a lit
 * stage, a Match / Your Photo switch under it, and the centering read only
 * while the photo is up. A product page, not a comparison table.
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

export function MatchHero({
  match,
  photoSrc,
  centering,
}: {
  /** The catalogue art (or the no-art placeholder), filling its box. */
  match: React.ReactNode;
  /** The seller's photo; search-added cards have none. */
  photoSrc: string | null;
  /** Run the yellow-border centering read (Pokémon only). */
  centering: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [view, setView] = useState<"match" | "photo">("match");
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

  const showPhoto = Boolean(photoSrc) && view === "photo";
  const done = state.kind === "done" ? state.result : null;
  const tone = !done ? "text-zinc-500" : done.psaMax >= 9 ? "text-emerald-400" : done.psaMax >= 7 ? "text-amber-300" : "text-rose-400";
  const dot = !done ? "bg-zinc-600" : done.psaMax >= 9 ? "bg-emerald-400" : done.psaMax >= 7 ? "bg-amber-300" : "bg-rose-400";

  return (
    <div className="w-full shrink-0 sm:w-64">
      {/* The stage: a lit surface with one card standing on it. */}
      <div className="relative overflow-hidden rounded-2xl border border-edge bg-surface-1 px-6 pb-5 pt-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(60% 55% at 50% 30%, rgba(170,180,255,0.16), transparent 70%)" }}
        />
        <div className="relative mx-auto aspect-[5/7] w-[62%] overflow-hidden rounded-xl bg-black/40 shadow-2xl shadow-black/60 ring-1 ring-white/10 sm:w-[82%]">
          {/* Both layers stay mounted so the centering canvas keeps its
              drawing; the switch only changes which one is visible. */}
          <div className={showPhoto ? "invisible" : ""}>{match}</div>
          {photoSrc && (
            <div className={`absolute inset-0 ${showPhoto ? "" : "invisible"}`}>
              {/* The photo blurred and stretched behind the contained one,
                  so a phone photo that is not 5:7 fills the card with its
                  own colours instead of black bars. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoSrc} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc}
                alt="The photo you uploaded"
                className={`absolute inset-0 h-full w-full object-contain ${done ? "invisible" : ""}`}
              />
              {/* Same photo with the centering box drawn on; same box and
                  object-fit, so it lands exactly over the img. */}
              <canvas ref={canvasRef} aria-hidden={!done} className={`absolute inset-0 h-full w-full object-contain ${done ? "" : "hidden"}`} />
            </div>
          )}
        </div>
      </div>

      {photoSrc && (
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-full border border-edge bg-surface-1 p-1" role="tablist" aria-label="Which card to show">
          {(["match", "photo"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-full py-2 text-sm font-semibold transition ${
                view === v ? "bg-surface-3 text-white shadow-sm shadow-black/30" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {v === "match" ? "Match" : "Your Photo"}
            </button>
          ))}
        </div>
      )}

      {showPhoto && state.kind !== "off" && (
        <div className="mt-3 px-1 text-xs">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            {state.kind === "working" && <span className="text-zinc-500">Checking centering…</span>}
            {state.kind === "none" && <span className="text-zinc-400">Centering not measured</span>}
            {done && (
              <>
                <span className="font-display text-sm text-white">
                  {done.horizontal} <span className="text-[11px] text-zinc-500">L/R</span>
                </span>
                <span className="font-display text-sm text-white">
                  {done.vertical} <span className="text-[11px] text-zinc-500">T/B</span>
                </span>
                <span className={`ml-auto truncate ${tone}`}>{done.verdict}</span>
              </>
            )}
          </div>
          {state.kind === "none" && <p className="mt-0.5 pl-3.5 text-[11px] text-zinc-600">Keep the whole yellow border in frame next time.</p>}
          {done && done.borders.clipped && <p className="mt-0.5 pl-3.5 text-[11px] text-zinc-600">Rough read: the border touches the photo edge.</p>}
          {done && !done.borders.clipped && done.psaMax < 10 && <p className="mt-0.5 pl-3.5 text-[11px] text-zinc-600">PSA 10 needs 55/45 or better.</p>}
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
