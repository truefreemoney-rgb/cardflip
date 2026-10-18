"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SAMPLE_VIEWPORT, type HeatDevice } from "@/lib/heatmap";

interface Tap {
  x: number;
  y: number;
  h: number;
  fixed: number;
}

/** Frame documents already listened to (a load can be seen twice: the server-rendered frame, then onLoad). */
const watchedDocs = new WeakSet<Document>();

/** Spot radius in page pixels. */
const RADIUS = 26;
/** Tallest page drawn (px); taps further down are still counted, just not painted. */
const MAX_PAGE = 12000;

/** 256-step blue → green → yellow → red lookup for the heat. */
function palette(): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, "rgba(0,0,255,0)");
  grad.addColorStop(0.25, "rgb(0,120,255)");
  grad.addColorStop(0.55, "rgb(0,220,90)");
  grad.addColorStop(0.8, "rgb(255,220,0)");
  grad.addColorStop(1, "rgb(255,30,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 1);
  return g.getImageData(0, 0, 256, 1).data;
}

/** One heat layer: soft spots summed, then coloured by how many overlap. `k` draws a big page at a lower resolution. */
function heatLayer(points: { x: number; y: number }[], w: number, h: number, k: number, colors: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const r = RADIUS * k;
  for (const p of points) {
    const grad = g.createRadialGradient(p.x * k, p.y * k, 0, p.x * k, p.y * k, r);
    grad.addColorStop(0, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(p.x * k - r, p.y * k - r, r * 2, r * 2);
  }
  if (points.length === 0) return c;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let max = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > max) max = d[i];
  const scale = max ? 255 / max : 1;
  for (let i = 0; i < d.length; i += 4) {
    const a = Math.min(255, Math.round(d[i + 3] * scale));
    if (a === 0) continue;
    d[i] = colors[a * 4];
    d[i + 1] = colors[a * 4 + 1];
    d[i + 2] = colors[a * 4 + 2];
    d[i + 3] = Math.min(220, 60 + a);
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * The heat map picture (/admin/heatmap): the live page in a phone- or
 * laptop-sized frame, the taps painted over it. Scrolling inside the frame
 * moves the page and the paint together; taps on a fixed bar (tab bar,
 * header) stay where the bar sits. Links in the frame don't navigate, so the
 * picture stays on the page the numbers are about. The frame itself never
 * records (lib/client/framed.ts).
 */
export default function HeatFrame({ src, device, taps }: { src: string; device: HeatDevice; taps: Tap[] }) {
  const S = SAMPLE_VIEWPORT[device];
  const k = device === "phone" ? 1 : 0.5;
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const layers = useRef<{ page: HTMLCanvasElement; fixed: HTMLCanvasElement } | null>(null);
  const [scale, setScale] = useState(1);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / S.w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [S.w]);

  const draw = useCallback(() => {
    const c = overlay.current;
    const L = layers.current;
    if (!c || !L) return;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    if (!show) return;
    const y = frame.current?.contentWindow?.scrollY ?? 0;
    g.drawImage(L.page, 0, y * k, S.w * k, S.h * k, 0, 0, S.w, S.h);
    g.drawImage(L.fixed, 0, 0, S.w, S.h);
  }, [S.w, S.h, k, show]);

  useEffect(() => {
    const colors = palette();
    const onPage = taps.filter((t) => !t.fixed && t.y < MAX_PAGE).map((t) => ({ x: (t.x / 1000) * S.w, y: t.y }));
    const onBar = taps.filter((t) => t.fixed).map((t) => ({ x: (t.x / 1000) * S.w, y: (t.y / Math.max(1, t.h)) * S.h }));
    const tall = Math.min(MAX_PAGE, Math.max(S.h, ...onPage.map((p) => p.y + RADIUS * 2)));
    layers.current = { page: heatLayer(onPage, S.w, tall, k, colors), fixed: heatLayer(onBar, S.w, S.h, 1, colors) };
    draw();
  }, [taps, S.w, S.h, k, draw]);

  // The scroll listener calls whatever draw is current (the "Show taps" box swaps it).
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const onLoad = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    try {
      if (watchedDocs.has(win.document)) {
        drawRef.current();
        return;
      }
      watchedDocs.add(win.document);
      win.addEventListener("scroll", () => requestAnimationFrame(() => drawRef.current()), { passive: true });
      // Taps in the picture stay on this page.
      win.document.addEventListener(
        "click",
        (e) => {
          if ((e.target as Element | null)?.closest?.("a,button,form")) e.preventDefault();
        },
        true,
      );
    } catch {
      // A page that redirected off-site can't be watched; the paint stays at the top.
    }
    drawRef.current();
  }, []);

  // The frame is in the server HTML, so it can finish loading before React attaches onLoad: catch that load here.
  useEffect(() => {
    if (frame.current?.contentDocument?.readyState === "complete") onLoad();
  }, [onLoad]);

  return (
    <div>
      <div ref={box} className="w-full">
        <div className="relative mx-auto overflow-hidden rounded-2xl border border-edge bg-black" style={{ width: S.w * scale, height: S.h * scale }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: S.w, height: S.h, transform: `scale(${scale})` }}>
            <iframe ref={frame} src={src} title="Page preview" onLoad={onLoad} className="absolute inset-0 h-full w-full border-0 bg-white" />
            <canvas ref={overlay} width={S.w} height={S.h} className="pointer-events-none absolute inset-0" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-500">
        <span>Scroll inside the picture to move down the page.</span>
        <label className="flex shrink-0 items-center gap-1.5 text-zinc-300">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-brand-500" />
          Show taps
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
        <span>Fewer taps</span>
        <span className="h-2 flex-1 rounded-full" style={{ background: "linear-gradient(90deg, rgb(0,120,255), rgb(0,220,90), rgb(255,220,0), rgb(255,30,0))" }} />
        <span>Most taps</span>
      </div>
    </div>
  );
}
