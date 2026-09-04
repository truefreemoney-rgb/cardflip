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
        {/* The scan, shown before the first scan (Chris, 09-04: "give a view
            of what it's like to scan and find the card — this is the first
            thing a new user sees after paying"): a real, live-priced card
            sits in the viewfinder, the laser sweeps it, and the Found chip
            reads the match and price under it — the reveal, at rest.
            Nothing fabricated: the card and price are the landing page's
            featured catalog row. No card yet = just the buttons. */}
        {showcase && (
          <div className="flex flex-col items-center">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">A scan, start to finish</p>
            <div className={`relative transition-transform duration-300 ${dragOver ? "scale-95 opacity-60" : ""}`}>
              <div className="w-[150px] sm:w-[168px]">
                <HoloCard src={showcase.imageUrl} alt={showcase.name} />
              </div>
              {/* The laser, over the card, clipped to its shape */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl" aria-hidden>
                <span className="scan-sweep" />
              </div>
              {/* Holo brackets, one spectrum colour per corner */}
              <span aria-hidden className="absolute -left-2.5 -top-2.5 h-7 w-7 rounded-tl-lg border-l-2 border-t-2 border-holo-sky" />
              <span aria-hidden className="absolute -right-2.5 -top-2.5 h-7 w-7 rounded-tr-lg border-r-2 border-t-2 border-holo-violet" />
              <span aria-hidden className="absolute -bottom-2.5 -left-2.5 h-7 w-7 rounded-bl-lg border-b-2 border-l-2 border-holo-pink" />
              <span aria-hidden className="absolute -bottom-2.5 -right-2.5 h-7 w-7 rounded-br-lg border-b-2 border-r-2 border-holo-gold" />
            </div>
            {/* The result chip, as the HUD shows it after a match */}
            <div className="mt-5 flex max-w-full items-center gap-3 rounded-full border border-emerald-400/30 bg-emerald-400/10 py-1.5 pl-2 pr-4 text-left">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-[11px] font-bold text-black">✓</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-white">{showcase.name}</span>
                <span className="block truncate text-[11px] text-zinc-400">
                  {showcase.setName} · {showcase.number}
                </span>
              </span>
              {showcase.price != null && (
                <span className="ml-1 shrink-0 font-display text-lg font-semibold text-emerald-300">${showcase.price.toFixed(2)}</span>
              )}
            </div>
          </div>
        )}

        <p className={`text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 ${showcase ? "mt-5" : "mt-1"}`}>
          {dragOver ? "Drop to scan" : showcase ? "Your turn" : "Ready when you are"}
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
