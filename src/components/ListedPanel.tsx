"use client";

import { useState } from "react";
import CardImage from "@/components/CardImage";
import type { ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  onChange: (patch: Partial<ScanItem>) => void;
}

function timeAgo(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export default function ListedPanel({ item, onChange }: Props) {
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
        </div>
      </div>

      <div className="w-full max-w-xs rounded-2xl border border-edge bg-surface-1 p-5">
        <p className="mb-3 flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Simulate a sale
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] normal-case text-zinc-400">
            demo
          </span>
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

      <button
        onClick={revert}
        className="text-xs text-zinc-500 underline underline-offset-4 transition hover:text-zinc-300"
      >
        Not listed after all — back to editing
      </button>
    </div>
  );
}
