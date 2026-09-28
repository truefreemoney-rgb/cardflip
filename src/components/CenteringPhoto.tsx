"use client";

import { useEffect, useRef, useState } from "react";
import { checkCentering, type Centering } from "@/lib/centering";

/**
 * "Your photo" with the centering check drawn on it (09-27, Tier 1 #2).
 * Runs entirely in the browser off the scan photo: no extra vision spend.
 * Pokémon only (yellow border); other games get the plain photo.
 *
 * The drawn box follows the measured inner edge of the border, and each
 * side carries its share of the border as a percent. Under the photo: the
 * L/R and T/B pair and the PSA verdict. When the border cannot be measured
 * the caption says so; a number is never invented.
 */

const MAX_EDGE = 640;

type State =
  | { kind: "working" }
  | { kind: "none" }
  | { kind: "done"; result: Centering };

export function CenteringPhoto({ src, enabled }: { src: string; enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    if (!enabled) return;
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
        setState({ kind: "none" });
        return;
      }
      draw(ctx, result, W);
      setState({ kind: "done", result });
    };
    img.onerror = () => { if (!cancelled) setState({ kind: "none" }); };
    img.src = src;
    return () => { cancelled = true; };
  }, [src, enabled]);

  if (!enabled) {
    return (
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="The photo you uploaded" className="h-56 w-auto rounded-xl object-contain opacity-90 shadow-xl shadow-black/40" />
        <p className="mt-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-600">Your photo</p>
      </div>
    );
  }

  const done = state.kind === "done" ? state.result : null;
  const tone = !done ? "text-zinc-500" : done.psaMax >= 9 ? "text-emerald-400" : done.psaMax >= 7 ? "text-amber-300" : "text-rose-400";

  return (
    <div className="w-max max-w-full">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="The photo you uploaded"
          className={`h-56 w-auto rounded-xl object-contain shadow-xl shadow-black/40 ${done ? "invisible" : "opacity-90"}`}
        />
        {/* The canvas holds the same photo with the centering box drawn on;
            it sits over the img so the layout box never changes. */}
        <canvas
          ref={canvasRef}
          aria-hidden={!done}
          className={`absolute inset-0 h-56 w-auto rounded-xl ${done ? "" : "hidden"}`}
        />
      </div>
      <p className="mt-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-600">
        {done ? "Centering" : "Your photo"}
      </p>
      {state.kind === "working" && <p className="mt-1 text-center text-xs text-zinc-600">Checking centering…</p>}
      {state.kind === "none" && (
        <p className="mt-1 max-w-[14rem] text-center text-xs text-zinc-600">
          Couldn&apos;t measure centering on this photo. It needs the whole yellow border in frame.
        </p>
      )}
      {done && (
        <div className="mt-1 max-w-[14rem] text-center">
          <p className="font-display text-sm text-white">
            <span className="text-zinc-500">L/R</span> {done.horizontal}
            <span className="ml-3 text-zinc-500">T/B</span> {done.vertical}
          </p>
          <p className={`mt-0.5 text-xs ${tone}`}>{done.verdict}</p>
          {done.borders.clipped ? (
            <p className="mt-0.5 text-[11px] text-zinc-600">Rough read: the border touches the photo edge</p>
          ) : done.psaMax < 10 ? (
            <p className="mt-0.5 text-[11px] text-zinc-600">PSA 10 needs 55/45 or better</p>
          ) : null}
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
