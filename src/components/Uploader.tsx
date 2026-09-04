"use client";

import { useRef, useState } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  /**
   * Owned by the page, not this component: the first capture flips the page
   * from the hero layout to the queue layout, which unmounts this uploader —
   * a locally-rendered camera modal would vanish mid-stack.
   */
  onOpenCamera?: () => void;
  variant?: "hero" | "compact";
}

export default function Uploader({ onFiles, onOpenCamera, variant = "hero" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  function handle(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) onFiles(files);
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      onChange={(e) => {
        handle(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (variant === "compact") {
    // One button (Chris, 09-01): the camera IS how you add more cards on a
    // phone, so a tap goes straight there. On desktop (fine pointer) jumping
    // to the webcam is wrong (Chris, 09-02) — the same button opens a small
    // camera-or-photos menu instead. Without a camera handler the picker
    // keeps the label so adding still works.
    const handleClick = () => {
      if (!onOpenCamera) {
        inputRef.current?.click();
        return;
      }
      if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) {
        setMenuOpen((v) => !v);
      } else {
        onOpenCamera();
      }
    };
    return (
      <div className="relative">
        <button
          onClick={handleClick}
          className="rounded-full border border-edge bg-surface-1 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:bg-surface-2"
        >
          {onOpenCamera && <span aria-hidden>📷 </span>}Add more cards
        </button>
        {menuOpen && (
          <>
            {/* Click-away backdrop */}
            <button
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close add-cards menu"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-edge bg-surface-2 py-1 shadow-xl shadow-black/40">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  inputRef.current?.click();
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-zinc-200 transition hover:bg-white/5"
              >
                🖼️ Choose photos
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenCamera?.();
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-zinc-200 transition hover:bg-white/5"
              >
                📷 Use camera
              </button>
            </div>
          </>
        )}
        {input}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handle(e.dataTransfer.files);
      }}
      className={`foil-edge relative w-full max-w-2xl overflow-hidden rounded-3xl [--foil-fill:#0a0b12] transition-transform duration-300 ${
        dragOver ? "scale-[1.01]" : ""
      }`}
    >
      {/* The stage (Chris, 09-04 "aggressive makeover"): the empty scanner
          looks like the viewfinder it is about to become — dot grid, a card
          guide with holo brackets, the laser sweep already running — so the
          first tap feels like a continuation, not a form. */}
      <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_42%,rgba(99,102,241,0.22),transparent_70%)]"
        aria-hidden
      />

      <div className="relative flex flex-col items-center px-6 pb-6 pt-7 sm:pb-7 sm:pt-8">
        {/* Card guide: 2.5 × 3.5, the shape a card takes in the real HUD. */}
        <div className="relative h-[196px] w-[140px] sm:h-[224px] sm:w-[160px]" aria-hidden>
          <div
            className={`absolute inset-0 overflow-hidden rounded-xl border transition-colors ${
              dragOver ? "border-brand-400/70 bg-brand-500/15" : "border-white/15 bg-white/[0.03]"
            }`}
          >
            <span className="scan-sweep" />
          </div>
          {/* Holo brackets, one spectrum colour per corner */}
          <span className="absolute -left-1 -top-1 h-6 w-6 rounded-tl-lg border-l-2 border-t-2 border-holo-sky" />
          <span className="absolute -right-1 -top-1 h-6 w-6 rounded-tr-lg border-r-2 border-t-2 border-holo-violet" />
          <span className="absolute -bottom-1 -left-1 h-6 w-6 rounded-bl-lg border-b-2 border-l-2 border-holo-pink" />
          <span className="absolute -bottom-1 -right-1 h-6 w-6 rounded-br-lg border-b-2 border-r-2 border-holo-gold" />
          {/* Ghost card: name plate, art box, footer so the guide reads as a card */}
          <div className="absolute inset-x-3 top-3 h-2.5 rounded bg-white/10" />
          <div className="absolute inset-x-3 top-8 h-[44%] rounded-md bg-white/[0.05]" />
          <div className="absolute inset-x-3 bottom-3 h-2 rounded bg-white/[0.07]" />
        </div>

        <p className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
          {dragOver ? "Drop to scan" : "Ready when you are"}
        </p>

        <div className="mt-3 flex w-full max-w-xs flex-col items-stretch gap-2 sm:w-auto sm:max-w-none sm:flex-row sm:items-center">
          {/* Camera leads (Chris, 09-01): scanning live is the main road, the
              photo picker is the fallback. */}
          {onOpenCamera && (
            <button
              onClick={onOpenCamera}
              data-tour="capture"
              className="sheen rounded-full bg-brand-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:-translate-y-0.5 hover:bg-brand-400"
            >
              Scan a card
            </button>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-full border border-edge bg-surface-2/80 px-6 py-3.5 text-sm font-semibold text-zinc-200 transition hover:-translate-y-0.5 hover:border-edge-strong"
          >
            Upload photos
          </button>
        </div>

        <p className="mt-3 text-[11px] text-zinc-600">Or drop photos anywhere on this panel · JPG, PNG, HEIC · a whole stack at once is fine</p>
      </div>
      {input}
    </div>
  );
}
