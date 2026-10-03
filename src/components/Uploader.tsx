"use client";

import Link from "next/link";
import HoloCard from "@/components/HoloCard";
import { formatMoney } from "@/lib/listing";
import type { ReactNode } from "react";
import { GAMES } from "@/lib/games";
import type { GameId } from "@/lib/types";

/**
 * The empty scanner's stage and its one way in: the camera. Photo uploads,
 * drag-and-drop, binder-page photos and the sealed-product sheet were removed
 * 10-03 (Chris: eBay rejects listings that reuse stock pictures, every card
 * must be a photo the seller took here, and uploads earned nothing). The CSV
 * import went the same day: scanning is the only way a card gets in.
 */
interface Props {
  /**
   * Owned by the page, not this component: the first capture flips the page
   * from the hero layout to the queue layout, which unmounts this uploader —
   * a locally-rendered camera modal would vanish mid-stack.
   */
  onOpenCamera?: () => void;
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

export default function Uploader({ onOpenCamera, variant = "hero", showcase = [], game }: Props) {
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

  if (variant === "compact") {
    // One button (Chris, 09-01): the camera IS how you add more cards. The
    // desktop camera-or-photos menu went with the uploads (10-03).
    return (
      <div className="relative flex flex-1 items-center gap-2 sm:ml-auto sm:flex-none">
        <button
          onClick={onOpenCamera}
          disabled={!onOpenCamera}
          className="flex-1 whitespace-nowrap rounded-full border border-edge bg-surface-1 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:bg-surface-2 disabled:opacity-50 sm:flex-none sm:px-4"
        >
          <span aria-hidden>🃏 </span>
          <span className="sm:hidden">Add Cards</span>
          <span className="hidden sm:inline">Add more cards</span>
        </button>
      </div>
    );
  }

  const tile =
    "flex min-w-0 items-center gap-2.5 rounded-2xl border border-edge bg-surface-1 px-3 py-2.5 text-left transition hover:border-edge-strong hover:bg-surface-2";

  return (
    <div className="grid w-full max-w-md gap-4 sm:max-w-4xl sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-8">
      {/* The viewfinder (09-30): a camera screen, not a marketing panel. The
          example scan sits inside it the way the live HUD shows a match (Chris,
          09-04: "give a view of what it's like to scan and find the card"),
          labelled as an example. Nothing fabricated: a real catalog card with
          its live price (lib/server/stageCards.ts). No card yet = an empty guide. */}
      <div
        // scan-stage: keeps the laser sweep looping under reduced motion (globals.css).
        className="scan-stage relative isolate flex aspect-square w-full items-center sm:aspect-[4/5] justify-center overflow-hidden rounded-3xl border border-edge-strong bg-[#06070c] shadow-2xl shadow-black/50"
      >
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_45%,rgba(99,102,241,0.28),transparent_72%)]"
          aria-hidden
        />
        {/* Screen vignette */}
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.85)]" aria-hidden />

        <span className="absolute left-3 top-3 rounded-full border border-edge bg-black/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400 backdrop-blur-sm">
          {card ? "Example scan" : "Ready"}
        </span>

        <div className={`relative transition duration-300 ${card ? "-mt-12 sm:-mt-10" : ""}`}>
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
        {/* Camera leads (Chris, 09-01): scanning live is the main road. Since 10-03 it is the only road. */}
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

        {/* One tile under Scan (Chris 10-03): the full feature list as a button of the same shape, since the scanner
            is the first screen on every open and the phone header has no room for the word. The CSV import went
            the same day ("i just think its dumb"): scanning is the only way a card gets in. */}
        <Link href="/features" className={tile}>
          <TileBody label="Everything CardFlip does" hint="Every feature on one page" icon={<IconSpark />} />
        </Link>
      </div>
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
function IconSpark() {
  return (
    <svg {...svg}>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </svg>
  );
}
