"use client";

import Link from "next/link";
import HoloCard from "@/components/HoloCard";
import { formatMoney } from "@/lib/listing";
import { useRef, useState, type ReactNode } from "react";
import { GAMES } from "@/lib/games";
import type { GameId } from "@/lib/types";

interface Props {
  onFiles: (files: File[]) => void;
  /**
   * Owned by the page, not this component: the first capture flips the page
   * from the hero layout to the queue layout, which unmounts this uploader —
   * a locally-rendered camera modal would vanish mid-stack.
   */
  onOpenCamera?: () => void;
  /** Binder-page photos: each one is split into a card per pocket (lib/client/binder.ts). */
  onPageFiles?: (files: File[]) => void;
  /** Why the last page photo queued nothing, shown under the buttons. */
  pageError?: string | null;
  /** Opens the "Add a sealed product" sheet (photo + set + kind; SealedAddSheet). */
  onSealed?: () => void;
  variant?: "hero" | "compact";
  /** Real, live-priced cards for the stage (from /api/cards/featured); empty = no card yet. */
  showcase?: ShowcaseCard[];
  /** The game the scanner reads as — named on the Scan button (Chris 09-29: testers missed the switch). */
  game?: GameId;
}

export interface ShowcaseCard {
  name: string;
  setName: string;
  number: string;
  imageUrl: string;
  price: number | null;
  /** The card the stage is meant to show — set by lib/server/stageCards.ts. */
  lead?: boolean;
}

export default function Uploader({ onFiles, onOpenCamera, onPageFiles, pageError, onSealed, variant = "hero", showcase = [], game }: Props) {
  // One card, still (Chris, 09-07: "just keep 1 card in the center, no need
  // to rotate images"), and not the Charizard: the card the server marked as
  // the stage lead (lib/server/stageCards.ts picks it — currently a full-art
  // Pikachu around $35). Repeated "change the card" tasks kept editing that
  // slot server-side while this component re-derived its own choice by price,
  // so the rename didn't always reach the screen.
  // Fallback for a payload with no lead (the mirror-less dev path): nearest
  // the same target, so it still reads as a card a seller actually has.
  const STAGE_TARGET_USD = 35;
  const card =
    showcase.find((c) => c.lead) ??
    (showcase.length
      ? [...showcase].sort(
          (a, b) => Math.abs((a.price ?? Infinity) - STAGE_TARGET_USD) - Math.abs((b.price ?? Infinity) - STAGE_TARGET_USD),
        )[0]
      : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  function handle(list: FileList | null, to: (files: File[]) => void = onFiles) {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) to(files);
  }

  const input = (
    <>
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
      {onPageFiles && (
        <input
          ref={pageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          data-testid="page-input"
          onChange={(e) => {
            handle(e.target.files, onPageFiles);
            e.target.value = "";
          }}
        />
      )}
    </>
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
      // Phones: the two Add buttons split the row evenly; desktop: natural width.
      <div className="relative flex flex-1 items-center gap-2 sm:ml-auto sm:flex-none">
        <button
          onClick={handleClick}
          className="flex-1 whitespace-nowrap rounded-full border border-edge bg-surface-1 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:bg-surface-2 sm:flex-none sm:px-4"
        >
          {/* Card icon, not a camera: the label says what you add, the
              sibling "Add Sealed" uses a box (Chris, 09-28). */}
          <span aria-hidden>🃏 </span>
          <span className="sm:hidden">Add Cards</span>
          <span className="hidden sm:inline">Add more cards</span>
        </button>
        {/* Phones skip the menu (the tap IS the camera), so sealed product
            needs its own way in once the queue exists. A worded button, not
            a box icon (Chris, 09-28: "doesn't make sense to a user"). */}
        {onSealed && (
          <button
            type="button"
            onClick={onSealed}
            className="flex-1 whitespace-nowrap rounded-full border border-edge bg-surface-1 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:bg-surface-2 sm:flex-none sm:px-4"
          >
            <span aria-hidden>📦 </span>
            <span className="sm:hidden">Add Sealed</span>
            <span className="hidden sm:inline">Add Sealed Product</span>
          </button>
        )}
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
              {onPageFiles && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    pageInputRef.current?.click();
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm text-zinc-200 transition hover:bg-white/5"
                >
                  📖 Binder page photo
                </button>
              )}
              {onSealed && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onSealed();
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm text-zinc-200 transition hover:bg-white/5"
                >
                  📦 Sealed product
                </button>
              )}
              <Link
                href="/app/collection/import"
                onClick={() => setMenuOpen(false)}
                className="block w-full px-4 py-2.5 text-left text-sm text-zinc-200 transition hover:bg-white/5"
              >
                📄 Import a CSV
              </Link>
            </div>
          </>
        )}
        {input}
      </div>
    );
  }

  // The other ways in, as real buttons (09-30 makeover, Chris: the page "seems
  // old and outdated"): they were a line of grey underlined text nobody read.
  const tile =
    "flex min-w-0 items-center gap-2.5 rounded-2xl border border-edge bg-surface-1 px-3 py-2.5 text-left transition hover:border-edge-strong hover:bg-surface-2";

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
      className="grid w-full max-w-md gap-4 sm:max-w-3xl sm:grid-cols-2 sm:items-center sm:gap-6"
    >
      {/* The viewfinder (09-30): a camera screen, not a marketing panel. The
          example scan sits inside it the way the live HUD shows a match (Chris,
          09-04: "give a view of what it's like to scan and find the card"),
          labelled as an example. Nothing fabricated: a real catalog card with
          its live price (lib/server/stageCards.ts). No card yet = an empty guide. */}
      <div
        // scan-stage: keeps the laser sweep looping under reduced motion (globals.css).
        className={`scan-stage relative isolate flex aspect-square w-full items-center sm:aspect-[4/5] justify-center overflow-hidden rounded-3xl border border-edge-strong bg-[#06070c] shadow-2xl shadow-black/50 transition-transform duration-300 ${
          dragOver ? "scale-[1.02] border-brand-400" : ""
        }`}
      >
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_45%,rgba(99,102,241,0.28),transparent_72%)]"
          aria-hidden
        />
        {/* Screen vignette */}
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.85)]" aria-hidden />

        <span className="absolute left-3 top-3 rounded-full border border-edge bg-black/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400 backdrop-blur-sm">
          {dragOver ? "Drop to scan" : card ? "Example scan" : "Ready"}
        </span>

        <div className={`relative transition duration-300 ${dragOver ? "scale-95 opacity-50" : ""} ${card ? "-mt-12 sm:-mt-10" : ""}`}>
          {card ? (
            <div key={card.imageUrl} className="tour-in w-[36vw] max-w-[150px] sm:w-[180px] sm:max-w-[190px]">
              <HoloCard src={card.imageUrl} alt={card.name} />
            </div>
          ) : (
            <div className="aspect-[63/88] w-[46vw] max-w-[190px] rounded-xl border border-dashed border-edge-strong sm:w-[180px]" />
          )}
          {/* The laser, over the card, clipped to its shape */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl" aria-hidden>
            <span className="scan-sweep" />
          </div>
          {/* Holo brackets, one spectrum colour per corner */}
          <span aria-hidden className="absolute -left-3 -top-3 h-8 w-8 rounded-tl-xl border-l-2 border-t-2 border-holo-sky" />
          <span aria-hidden className="absolute -right-3 -top-3 h-8 w-8 rounded-tr-xl border-r-2 border-t-2 border-holo-violet" />
          <span aria-hidden className="absolute -bottom-3 -left-3 h-8 w-8 rounded-bl-xl border-b-2 border-l-2 border-holo-pink" />
          <span aria-hidden className="absolute -bottom-3 -right-3 h-8 w-8 rounded-br-xl border-b-2 border-r-2 border-holo-gold" />
        </div>

        {/* The result chip, where the HUD puts it after a match */}
        {card && (
          <div
            key={card.imageUrl + "-chip"}
            className="tour-in absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-950/70 py-2 pl-2.5 pr-3.5 backdrop-blur-md"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-xs font-bold text-black">✓</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{card.name}</span>
              <span className="block truncate text-[11px] text-emerald-100/60">
                {card.setName} · {card.number}
              </span>
            </span>
            {card.price != null && (
              <span className="shrink-0 font-display text-xl font-semibold tabular-nums text-emerald-300">{formatMoney(card.price)}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {/* Desktop only: the phone layout stacks under the viewfinder and needs no words. */}
        <div className="hidden sm:mb-2 sm:block">
          <p className="font-display text-3xl font-bold tracking-tight text-white">Ready to scan</p>
          <p className="mt-1.5 text-sm text-zinc-400">Point the camera at a card. CardFlip names it, prices it and writes the eBay listing.</p>
        </div>
        {/* Camera leads (Chris, 09-01): scanning live is the main road. */}
        {onOpenCamera && (
          <button
            onClick={onOpenCamera}
            data-tour="capture"
            className="sheen flex w-full items-center justify-center gap-2.5 rounded-full bg-brand-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:-translate-y-0.5 hover:bg-brand-400"
          >
            <IconCamera />
            {game ? `Scan ${GAMES[game].label} Cards` : "Scan a Card"}
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} className={tile}>
            <TileBody label="Photos" hint="Upload a stack" icon={<IconImage />} />
          </button>
          {onPageFiles && (
            <button type="button" onClick={() => pageInputRef.current?.click()} className={tile}>
              <TileBody label="Binder Page" hint="A whole page" icon={<IconGrid />} />
            </button>
          )}
          {onSealed && (
            <button type="button" onClick={onSealed} className={tile}>
              <TileBody label="Sealed" hint="Boxes and packs" icon={<IconBox />} />
            </button>
          )}
          <Link href="/app/collection/import" className={tile}>
            <TileBody label="Import" hint="From other apps" icon={<IconFile />} />
          </Link>
        </div>

        {/* One quiet line to the full feature list (Chris 10-03): the scanner is the first screen on every open, and
            the phone header has no room for the word. Gone with the uploader once a scan is on screen. */}
        <p className="text-center text-[11px] text-zinc-500">
          New here?{" "}
          <Link href="/features" className="font-medium text-zinc-300 transition hover:text-white">
            See everything CardFlip does →
          </Link>
        </p>
        {/* Drag and drop only exists with a mouse. */}
        <p className="hidden text-center text-[11px] text-zinc-600 [@media(pointer:fine)]:block">
          Or drop photos anywhere here · JPG, PNG, HEIC · a whole stack at once is fine
        </p>
        {pageError && (
          <p role="status" className="text-center text-xs font-medium text-amber-300">
            {pageError}
          </p>
        )}
      </div>
      {input}
    </div>
  );
}

function TileBody({ label, hint, icon }: { label: string; hint: string; icon: ReactNode }) {
  return (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-zinc-100">{label}</span>
        <span className="block truncate text-[11px] text-zinc-500">{hint}</span>
      </span>
    </>
  );
}

const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
function IconCamera() {
  return (
    <svg {...svg} width={20} height={20}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
function IconImage() {
  return (
    <svg {...svg}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 16-5-5-8 8.5" />
    </svg>
  );
}
function IconGrid() {
  return (
    <svg {...svg}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16" />
    </svg>
  );
}
function IconBox() {
  return (
    <svg {...svg}>
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" />
      <path d="M4 7.5 12 11l8-3.5M12 11v9" />
    </svg>
  );
}
function IconFile() {
  return (
    <svg {...svg}>
      <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" />
    </svg>
  );
}
