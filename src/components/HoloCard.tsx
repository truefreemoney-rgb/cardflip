"use client";

import { useEffect, useRef } from "react";
import CardImage from "@/components/CardImage";

interface Props {
  src: string;
  alt: string;
  className?: string;
}

/**
 * A CSS-only "3D" card: perspective + rotateX/rotateY tracking the cursor,
 * plus a holo-foil shine layer that moves with it. There's no real 3D model
 * to render here (just a flat card photo), so this is the actual 3D effect
 * on offer — the same technique real holographic-card sites use — rather
 * than a literal WebGL scene, which would need geometry we don't have.
 *
 * Motion is a requestAnimationFrame lerp toward the cursor, written straight
 * to the DOM — no per-mousemove React render, and no CSS transition to fight
 * (or be zeroed by reduced-motion, which left the tilt snapping stepwise).
 * Cursor-following is interaction feedback, same ruling as the scanner HUD.
 */
export default function HoloCard({ src, alt, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0, px: 50, py: 50, s: 1, o: 0 });
  const current = useRef({ x: 0, y: 0, px: 50, py: 50, s: 1, o: 0 });
  const raf = useRef<number | null>(null);

  function tick() {
    const t = target.current;
    const c = current.current;
    let settled = true;
    for (const k of Object.keys(t) as (keyof typeof t)[]) {
      const d = t[k] - c[k];
      if (Math.abs(d) > 0.001) {
        c[k] += d * 0.16;
        settled = false;
      } else {
        c[k] = t[k];
      }
    }
    const el = cardRef.current;
    if (el) {
      el.style.transform = `perspective(900px) rotateX(${c.x}deg) rotateY(${c.y}deg) scale3d(${c.s}, ${c.s}, 1)`;
      el.style.setProperty("--shine-x", `${c.px}%`);
      el.style.setProperty("--shine-y", `${c.py}%`);
      el.style.setProperty("--shine-o", `${c.o}`);
    }
    raf.current = settled ? null : requestAnimationFrame(tick);
  }

  function kick() {
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, []);

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    target.current = {
      x: (50 - py) / 3.5, // rotateX
      y: (px - 50) / 3.5, // rotateY
      px,
      py,
      s: 1.04,
      o: 1,
    };
    kick();
  }

  function reset() {
    target.current = { x: 0, y: 0, px: 50, py: 50, s: 1, o: 0 };
    kick();
  }

  if (!src) {
    return <CardImage src={src} alt={alt} className={className} />;
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ perspective: "900px" }}
    >
      <div
        ref={cardRef}
        className={`relative overflow-hidden rounded-xl shadow-2xl shadow-black/60 will-change-transform ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="block h-full w-full object-cover" />

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: "calc(var(--shine-o, 0) * 0.6)",
            background:
              "radial-gradient(circle at var(--shine-x) var(--shine-y), rgba(255,255,255,0.95), transparent 45%)",
            mixBlendMode: "overlay",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: "calc(var(--shine-o, 0) * 0.4)",
            background:
              "linear-gradient(115deg, transparent 15%, #ff5fa2 28%, #7dd3fc 42%, #a78bfa 56%, #34d399 70%, transparent 85%)",
            backgroundSize: "260% 260%",
            backgroundPosition: "var(--shine-x) var(--shine-y)",
            mixBlendMode: "color-dodge",
          }}
        />
      </div>
    </div>
  );
}
