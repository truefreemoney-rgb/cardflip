"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Hint, Light, Point, Quad, QuadTrace } from "@/lib/photoQuality";

/**
 * ?dbg=outline (dev only): what the camera's edge finder sees on each live
 * tick and why it said no, the whole frame + its geometry to
 * api/dev/outline-dump every 2 s (scripts/outline-eval tunes the finder on
 * those offline), and a photo input that runs the real scan where there is no
 * camera (the browser pane). CameraCapture loads it only outside production,
 * so none of it ships (review 10-19 #25: ~110 lines of it sat in the prod
 * bundle).
 */

type Corners = [Point, Point, Point, Point];

/** One live tick's look, right after its hint is picked. */
export interface OutlineFrame {
  /** The sampler's crop around the guide (box.w x box.h). */
  crop: HTMLCanvasElement;
  /** The live picture: the video, or the mirror's canvas. */
  source: HTMLVideoElement | HTMLCanvasElement;
  track: MediaStreamTrack | undefined;
  mirror: boolean;
  vw: number;
  vh: number;
  /** The guide, in source pixels. */
  guide: { x: number; y: number; w: number; h: number };
  /** Where the crop sits in the source (sx..sh) and its own size (w, h). */
  box: { sx: number; sy: number; sw: number; sh: number; w: number; h: number };
  /** The guide on screen and in the video; read only when a dump goes out. */
  geometry: () => unknown;
  /** The guide, in the crop's pixels. */
  expect: { x: number; y: number; w: number; h: number };
  quad: Quad | null;
  trace: QuadTrace;
  light: Light;
  hint: Hint | null;
  /** The corners kept so far (guide fractions), before this tick's update. */
  target: Corners | null;
}

export interface OutlineDebugApi {
  frame(f: OutlineFrame): void;
  /** The tick's result once its corners are kept or dropped, for the next dump. */
  tick(reason: string, quad: Quad | null, target: Corners | null): void;
}

export default function CameraOutlineDebug({ apiRef, onCapture }: { apiRef: RefObject<OutlineDebugApi | null>; onCapture: (file: File) => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [text, setText] = useState("");
  const lastDump = useRef(0);
  const dumped = useRef(0);
  // Every tick's result between two dumps: the twitch lives between frames, not in them.
  const ticks = useRef<unknown[]>([]);

  useEffect(() => {
    apiRef.current = {
      frame(f) {
        const dc = canvas.current;
        if (!dc) return;
        const { crop, source, mirror, vw, vh, guide: g, box, quad, trace, light } = f;
        const { sx, sy, sw, sh, w, h } = box;
        const dctx = dc.getContext("2d");
        if (dctx) {
          dc.width = w;
          dc.height = h;
          dctx.drawImage(crop, 0, 0);
          // The guide, in the crop.
          dctx.strokeStyle = "#a78bfa";
          dctx.lineWidth = 1;
          dctx.strokeRect(((g.x - sx) / sw) * w, ((g.y - sy) / sh) * h, (g.w / sw) * w, (g.h / sh) * h);
          if (quad) {
            dctx.strokeStyle = "#34d399";
            dctx.lineWidth = 2;
            dctx.beginPath();
            quad.corners.forEach((p, i) => (i ? dctx.lineTo(p.x, p.y) : dctx.moveTo(p.x, p.y)));
            dctx.closePath();
            dctx.stroke();
          }
        }
        setText(
          `${trace.reason} · ${trace.sides} · T ${trace.T} max ${trace.maxStep} · luma ${Math.round(light.luma)} blown ${light.blown.toFixed(3)} · hint ${f.hint ?? "none"} · ${mirror ? "mirror" : "video"} ${vw}x${vh} · el ${source.clientWidth}x${source.clientHeight} · dumps ${dumped.current}`,
        );
        if (Date.now() - lastDump.current <= 2000) return;
        lastDump.current = Date.now();
        try {
          const full = document.createElement("canvas");
          full.width = vw;
          full.height = vh;
          full.getContext("2d")?.drawImage(source, 0, 0);
          const rect = source.getBoundingClientRect();
          const meta = {
            at: new Date().toISOString(),
            ua: navigator.userAgent,
            mirror,
            src: { vw, vh },
            element: { clientWidth: source.clientWidth, clientHeight: source.clientHeight, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } },
            trackSettings: f.track?.getSettings() ?? null,
            geometry: f.geometry(),
            crop: box,
            expect: f.expect,
            quad,
            trace,
            outlineTarget: f.target,
            ticks: ticks.current.splice(0),
          };
          void fetch("/api/dev/outline-dump", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ frame: full.toDataURL("image/jpeg", 0.85), meta }),
          }).then((r) => {
            if (r.ok) dumped.current++;
          }).catch(() => {
            // A dropped upload over the tunnel: Safari's "Load failed" popped the dev error badge (10-15).
          });
        } catch {
          // Debug only; never in the way.
        }
      },
      tick(reason, quad, target) {
        ticks.current.push({ t: Date.now(), reason, quad: quad?.corners ?? null, target });
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  return (
    <div className="pointer-events-none absolute left-1 top-1 z-30 max-w-[60%] rounded bg-black/80 p-1 text-[10px] leading-tight text-lime-300">
      <canvas ref={canvas} className="block w-32 border border-zinc-600" />
      <p className="mt-1 break-words">{text || "sampling…"}</p>
      {/* A photo fed in by hand runs the real scan where there is no camera (the browser pane). */}
      <input
        type="file"
        accept="image/*"
        data-dbg-capture
        className="pointer-events-auto mt-1 block w-full text-[10px]"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onCapture(file);
        }}
      />
    </div>
  );
}
