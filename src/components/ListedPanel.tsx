"use client";

import Link from "next/link";
import HoloCard from "@/components/HoloCard";
import { netAfterFees, POSTAGE_USD } from "@/lib/fees";
import { displayCardNumber } from "@/lib/games";
import type { ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  /** Kept for the editor's call site; the panel no longer reverts a listing (Chris, 09-04). */
  onChange?: (patch: Partial<ScanItem>) => void;
  /** Jump to the next card still being worked — for stack sessions. */
  onNext?: (() => void) | null;
}

/**
 * The moment after publishing: the card as a trophy, the price it's up
 * for and what it nets, and one big door to the live listing. No timestamp
 * ("just now") and no "not listed after all" — the listing is real; ending
 * it is an Inventory action (Chris, 09-04 makeover).
 */
export default function ListedPanel({ item, onNext }: Props) {
  const card = item.card!;
  const listedPrice = item.listedPrice ?? 0;
  const net = listedPrice > 0 ? Math.max(0, netAfterFees(listedPrice) - POSTAGE_USD) : 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 p-6 text-center sm:p-8">
      <div className="relative">
        {/* A soft eBay-blue glow behind the card marks the win without confetti. */}
        <div
          aria-hidden
          className="absolute -inset-8 -z-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(2,132,199,0.35),transparent_65%)] blur-2xl"
        />
        <HoloCard
          src={card.imageLarge || card.imageSmall || item.previewUrl}
          alt={card.name}
          className="aspect-[5/7] w-44 sm:w-52"
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-ebay/15 px-3.5 py-1 text-xs font-semibold text-sky-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
          </span>
          Live on eBay
        </span>
        <h2 className="font-display text-2xl font-semibold leading-tight text-white">{card.name}</h2>
        <p className="text-sm text-zinc-500">
          {card.setName} · {displayCardNumber(card)}
        </p>
      </div>

      <dl className="grid w-full max-w-xs grid-cols-2 divide-x divide-white/10 overflow-hidden rounded-xl border border-edge bg-surface-1">
        <div className="px-4 py-3">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Listed at</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold text-white">${listedPrice.toFixed(2)}</dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">You&apos;ll net</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold text-emerald-400" title="After eBay fees and postage">
            ${net.toFixed(2)}
          </dd>
        </div>
      </dl>

      <div className="flex w-full max-w-xs flex-col items-stretch gap-2.5">
        {/* The first thing a seller wants after publishing is to SEE the
            live listing (Chris, 09-02: the old tiny text link buried it). */}
        {item.ebayListingUrl && (
          <a
            href={item.ebayListingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-ebay px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/40 transition hover:bg-ebay-hover"
          >
            View your listing on eBay ↗
          </a>
        )}
        {/* Momentum after publish (Chris, 09-02: "list next card at the
            bottom and maybe track card in my cards"). */}
        {onNext && (
          <button
            onClick={onNext}
            className="rounded-full border border-edge bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            List the next card →
          </button>
        )}
      </div>

      {/* The sale records itself when the eBay order comes in (sales sync). */}
      <p className="max-w-xs text-xs leading-snug text-zinc-500">
        When it sells, it&apos;s marked sold here automatically. Change the price or end the listing from{" "}
        <Link href="/app/collection" className="text-zinc-300 underline underline-offset-2 hover:text-white">
          Inventory
        </Link>
        .
      </p>
    </div>
  );
}
