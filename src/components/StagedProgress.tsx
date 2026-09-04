"use client";

import { useEffect, useState } from "react";

/**
 * A wait that shows its work: the card in the scanner frame (laser sweep +
 * holo brackets, the same language as the camera guide and the read
 * tracker) over a list of steps that tick off on a timer. Used wherever a
 * static spinner used to sit — reopening a card from Inventory, publishing
 * to eBay (Chris, 09-04: "kinda static and odd, can we do something
 * better"). The last step holds until the caller unmounts this; the timing
 * is a stand-in for phases the request doesn't report.
 *
 * Lives inside `.scanner-hud` so the motion — feedback, not decoration —
 * survives reduced-motion (see globals.css).
 */
export default function StagedProgress({
  title,
  steps,
  stageMs,
  image,
  compact = false,
}: {
  title: string;
  steps: readonly string[];
  /** When each step after the first becomes active (ms since mount); length = steps.length - 1. */
  stageMs: readonly number[];
  /** The seller's photo or the catalogue art; null shows an empty frame. */
  image?: string | null;
  /** Smaller frame, for a dialog. */
  compact?: boolean;
}) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timers = stageMs.map((ms, i) => window.setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [stageMs]);

  return (
    <div className={`scanner-hud flex flex-col items-center text-center ${compact ? "gap-4" : "gap-6"}`}>
      <div className={`relative aspect-[63/88] ${compact ? "h-36" : "h-56"}`} aria-hidden>
        <div className="absolute inset-0 overflow-hidden rounded-xl bg-black/50 shadow-2xl shadow-black/50">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="h-full w-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_70%)]" />
          )}
          <span className="scan-sweep" />
        </div>
        <span className="absolute -left-px -top-px h-8 w-8 rounded-tl-xl border-l-3 border-t-3 border-holo-pink" />
        <span className="absolute -right-px -top-px h-8 w-8 rounded-tr-xl border-r-3 border-t-3 border-holo-pink" />
        <span className="absolute -bottom-px -left-px h-8 w-8 rounded-bl-xl border-b-3 border-l-3 border-holo-pink" />
        <span className="absolute -bottom-px -right-px h-8 w-8 rounded-br-xl border-b-3 border-r-3 border-holo-pink" />
      </div>

      <div role="status" aria-live="polite">
        <p className="font-display text-base font-semibold text-white">{title}</p>
        <ol className="mt-3 space-y-1.5 text-left text-sm">
          {steps.map((label, i) => {
            const done = i < stage;
            const active = i === stage;
            return (
              <li
                key={label}
                className={`flex items-center gap-2.5 transition-colors ${
                  done ? "text-emerald-400" : active ? "text-white" : "text-zinc-500"
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {done ? (
                    <svg
                      viewBox="0 0 16 16"
                      className="h-4 w-4 animate-fade-up"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 8.5l3 3 7-7" />
                    </svg>
                  ) : active ? (
                    <span className="h-2 w-2 rounded-full bg-holo-pink shadow-[0_0_8px_var(--color-holo-pink)] animate-pulse" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  )}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
