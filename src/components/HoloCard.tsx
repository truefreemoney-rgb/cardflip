"use client";

import { useRef, useState, type CSSProperties } from "react";
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
 */
export default function HoloCard({ src, alt, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0, px: 50, py: 50 });

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    setTilt({
      x: (50 - py) / 3.5, // rotateX
      y: (px - 50) / 3.5, // rotateY
      px,
      py,
    });
    setActive(true);
  }

  function reset() {
    setActive(false);
    setTilt({ x: 0, y: 0, px: 50, py: 50 });
  }

  if (!src) {
    return <CardImage src={src} alt={alt} className={className} />;
  }

  const wrapperStyle: CSSProperties = {
    transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale3d(${active ? 1.04 : 1}, ${active ? 1.04 : 1}, 1)`,
    ["--shine-x" as string]: `${tilt.px}%`,
    ["--shine-y" as string]: `${tilt.py}%`,
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ perspective: "900px" }}
    >
      <div
        style={wrapperStyle}
        className={`relative overflow-hidden rounded-xl shadow-2xl shadow-black/60 transition-transform duration-150 ease-out will-change-transform ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="block h-full w-full object-cover" />

        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-150"
          style={{
            opacity: active ? 0.6 : 0,
            background:
              "radial-gradient(circle at var(--shine-x) var(--shine-y), rgba(255,255,255,0.95), transparent 45%)",
            mixBlendMode: "overlay",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-150"
          style={{
            opacity: active ? 0.4 : 0,
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
