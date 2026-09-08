"use client";

import { useState } from "react";
import { fallbackArtUrl } from "@/lib/cardArt";

/**
 * For a plain <img> of catalog art: the src to render and an onError that
 * swaps a dead TCGdex image for its pokemontcg.io twin once (lib/cardArt.ts).
 * CardImage and HoloCard carry the same logic with their placeholders;
 * this is for the sites that render a bare <img> (landing wall, hero, the
 * staged-progress thumb).
 */
export function useArtSrc(src: string): { src: string; onError: () => void } {
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);
  const fallback = fallbackFor === src ? fallbackArtUrl(src) : null;
  return {
    src: fallback ?? src,
    onError: () => {
      if (fallbackFor !== src && fallbackArtUrl(src)) setFallbackFor(src);
    },
  };
}
