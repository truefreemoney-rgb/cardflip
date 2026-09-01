"use client";

import { useState } from "react";
import CardImage from "@/components/CardImage";
import type { ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  onChange: (patch: Partial<ScanItem>) => void;
  /** Jump to the next card still being worked — for stack sessions. */
  onNext?: (() => void) | null;
}

function timeAgo(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export default function ListedPanel({ item, onChange, onNext }: Props) {
  const card = item.card!;
  const listedPrice = item.listedPrice ?? 0;
  const [soldPrice, setSoldPrice] = useState(listedPrice);

  function markSold() {
    onChange({ status: "sold", soldPrice, soldAt: Date.now() });
  }

  function revert() {
    onChange({ status: "ready", listedPrice: null, listedAt: null });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-6 text-center sm:p-8">
      <div className="flex flex-col items-center gap-4">
        <CardImage
          src={card.imageLarge || card.imageSmall || item.previewUrl}
          alt={card.name}
          className="h-48 w-auto rounded-xl shadow-2xl shadow-black/50"
        />
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ebay/15 px-3 py-1 text-xs font-medium text-sky-300">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            Live on eBay
          </span>
          <h2 className="mt-2 text-lg font-semibold text-white">{card.name}</h2>
          <p className="text-sm text-zinc-500">
            Listed at ${listedPrice.toFixed(2)} ·{" "}
            {item.listedAt ? timeAgo(item.listedAt) : "just now"}
          </p>
          {item.ebayListingUrl && (
            <a
              href={item.ebayListingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-sky-300 underline underline-offset-4 hover:text-sky-200"
            >
              View on eBay ↗
            </a>
          )}
        </div>
      </div>

      <div className="w-full max-w-xs rounded-2xl border border-edge bg-surface-1 p-5">
        <p className="mb-1.5 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
          Record the sale
        </p>
        <p className="mb-3 text-center text-[11px] leading-snug text-zinc-600">
          Sold on eBay through CardFlip? It&apos;s marked automatically when
          the order comes in. This covers sales made anywhere else.
        </p>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
          Final sale price
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
              $
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={soldPrice}
              onChange={(e) => setSoldPrice(parseFloat(e.target.value) || 0)}
              className="w-full rounded-lg border border-edge bg-black/40 py-2.5 pl-6 pr-3 text-center text-sm text-white outline-none transition focus:border-brand-400"
            />
          </div>
        </label>
        <button
          onClick={markSold}
          className="mt-4 w-full rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
        >
          Mark as sold
        </button>
      </div>

      {/* Working a stack: the receipt stays (Chris, 09-01 — land on the Live
          panel), but the next unfinished card is one tap away instead of a
          sidebar hunt. */}
      {onNext && (
        <button
          onClick={onNext}
          className="-mt-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
        >
          Next card →
        </button>
      )}

      <button
        onClick={revert}
        className="text-xs text-zinc-500 underline underline-offset-4 transition hover:text-zinc-300"
      >
        Not listed after all — back to editing
      </button>
    </div>
  );
}
