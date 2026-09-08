"use client";

import { useArtSrc } from "@/lib/client/useArtSrc";

/**
 * A bare <img> of catalog art with the second-source swap (lib/cardArt.ts):
 * for the sites that don't want CardImage's placeholder box or HoloCard's
 * tilt — the landing wall, the hero, the staged-progress thumb.
 */
export default function ArtImg({
  src,
  alt = "",
  className,
  loading,
}: {
  src: string;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const art = useArtSrc(src);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={art.src} alt={alt} loading={loading} className={className} onError={art.onError} />;
}
