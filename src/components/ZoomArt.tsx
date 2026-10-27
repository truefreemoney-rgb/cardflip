"use client";

import { useEffect, useState } from "react";
import ArtImg from "@/components/ArtImg";

/**
 * The card page's main picture, tappable: opens the card full screen, any tap
 * (or Escape) closes it. The heat map showed most phone taps on card pages
 * landing on the picture and doing nothing (10-27).
 */
export default function ZoomArt({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Show ${alt} bigger`} className="block h-full w-full cursor-zoom-in">
        <ArtImg src={src} alt={alt} width={width} height={height} priority className="h-full w-full object-cover" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-3 backdrop-blur-sm"
        >
          <ArtImg src={src} alt={alt} width={width} height={height} className="max-h-full w-auto max-w-full rounded-2xl object-contain" />
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 h-11 rounded-full bg-white/10 px-4 text-sm font-semibold text-white">
            Close
          </button>
        </div>
      ) : null}
    </>
  );
}
