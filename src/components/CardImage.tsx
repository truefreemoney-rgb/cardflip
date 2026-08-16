"use client";

import { useState } from "react";

interface Props {
  src: string;
  alt: string;
  className?: string;
}

/**
 * TCGdex has no image data at all for the "ja" locale, and some English URLs
 * it *does* provide 404 (recent promos especially) — the mirror can't know
 * without fetching all 23k of them. So both the no-URL and the dead-URL case
 * land on the same placeholder instead of a broken-image icon.
 */
export default function CardImage({ src, alt, className = "" }: Props) {
  // Remembering *which* src failed (rather than a boolean) means a recycled
  // grid row that receives a new src gets a fresh chance to load it.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-edge-strong bg-surface-2 ${className}`}
        role="img"
        aria-label={alt}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 text-zinc-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="5" y="2.5" width="14" height="19" rx="2" />
          <circle cx="12" cy="12" r="3" />
          <path d="M9 12h6" />
        </svg>
        <span className="text-[9px] text-zinc-600">No image</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailedSrc(src)}
    />
  );
}
