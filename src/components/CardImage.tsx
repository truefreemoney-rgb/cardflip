"use client";

import { useEffect, useState } from "react";

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
  // One load failure is not a dead URL: a phone on a flaky connection
  // loading a stack of stock images at once drops some (Chris, 09-03: a
  // White Flare card whose URL serves fine showed "No image"). Retry twice,
  // cache-busted, before settling on the placeholder.
  const [retry, setRetry] = useState(0);
  const [pendingRetry, setPendingRetry] = useState(false);
  useEffect(() => {
    setRetry(0);
    setPendingRetry(false);
  }, [src]);
  useEffect(() => {
    if (!pendingRetry) return;
    const t = window.setTimeout(() => {
      setPendingRetry(false);
      setRetry((n) => n + 1);
    }, 1500 * (retry + 1));
    return () => window.clearTimeout(t);
  }, [pendingRetry, retry]);
  const effectiveSrc = retry > 0 && src ? `${src}${src.includes("?") ? "&" : "?"}r=${retry}` : src;

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
      src={effectiveSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => {
        if (retry < 2) setPendingRetry(true);
        else setFailedSrc(src);
      }}
    />
  );
}
