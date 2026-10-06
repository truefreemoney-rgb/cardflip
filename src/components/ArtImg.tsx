"use client";

import { useState } from "react";
import { useArtSrc } from "@/lib/client/useArtSrc";

/**
 * A bare <img> of catalog art with the second-source swap (lib/cardArt.ts):
 * for the sites that don't want CardImage's placeholder box or HoloCard's
 * tilt — the landing wall, the hero, the staged-progress thumb, the public
 * card pages. `width` / `height` reserve the box before the bytes land (card
 * art is 5:7), `priority` marks the page's main picture. Plain <img> on
 * purpose: catalog art is hotlinked, never run through image optimization.
 */
export default function ArtImg({
  src,
  alt = "",
  className,
  loading,
  width,
  height,
  priority = false,
}: {
  src: string;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
  width?: number;
  height?: number;
  priority?: boolean;
}) {
  const art = useArtSrc(src);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === art.src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={art.src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : loading}
      {...(priority ? { fetchPriority: "high" as const } : {})}
      decoding="async"
      ref={(el) => {
        if (el && el.complete && el.naturalWidth > 0) setLoadedSrc(art.src);
      }}
      className={loaded ? className : `${className ?? ""} skeleton`}
      onLoad={() => setLoadedSrc(art.src)}
      onError={art.onError}
    />
  );
}
