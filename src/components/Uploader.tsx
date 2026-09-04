"use client";

import HoloCard from "@/components/HoloCard";
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
  /** A real, live-priced card for the stage (from /api/cards/featured); null = no card yet. */
  showcase?: ShowcaseCard | null;
}

export interface ShowcaseCard {
  name: string;
  setName: string;
  number: string;
  imageUrl: string;
  price: number | null;
}

export default function Uploader({ onFiles, onOpenCamera, variant = "hero", showcase = null }: Props) {
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
        {/* A real card, live-priced, in the 3D holo tilt — the same one the
            landing page leads with. Nothing fabricated (DESIGN.md data
            honesty); while it loads, or if it can't, the stage is just the
            buttons. Chris, 09-04: the ghost outline "I hate this image". */}
        {showcase && (
          <div className={`w-[150px] transition-transform duration-300 sm:w-[168px] ${dragOver ? "scale-95 opacity-60" : ""}`}>
            <HoloCard src={showcase.imageUrl} alt={showcase.name} />
          </div>
        )}
        {showcase && (
          <p className="mt-4 text-center text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">{showcase.name}</span>
            {showcase.price != null && (
              <>
                {" "}
                · <span className="font-display font-semibold text-white">${showcase.price.toFixed(2)}</span>
                <span className="text-zinc-600"> live</span>
              </>
            )}
          </p>
        )}

        <p className={`text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 ${showcase ? "mt-2" : "mt-1"}`}>
          {dragOver ? "Drop to scan" : showcase ? "Yours next" : "Ready when you are"}
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
