"use client";

import { displayCardNumber } from "@/lib/games";
import CardImage from "@/components/CardImage";
import StatusChip from "@/components/StatusChip";
import { currentPrice } from "@/lib/listing";
import type { ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export default function QueueRow({ item, selected, onSelect, onRemove }: Props) {
  const price = item.card ? currentPrice(item) : null;

  return (
    <div
      className={`group relative flex items-center gap-3 rounded-xl border p-2.5 transition ${
        selected
          ? "border-brand-400/60 bg-brand-500/10"
          : "border-transparent hover:border-edge hover:bg-surface-1"
      }`}
    >
      <button
        onClick={onSelect}
        className="flex flex-1 items-center gap-3 text-left"
      >
        <CardImage
          src={item.card?.imageSmall || item.previewUrl}
          alt=""
          className="h-14 w-10 shrink-0 rounded-md object-cover shadow-md shadow-black/40"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {item.card ? item.card.englishName || item.card.name : "Identifying…"}
            {item.card?.englishName && (
              <span className="text-zinc-500"> ({item.card.englishName})</span>
            )}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            {item.card
              ? // Sealed products have no collector number to show.
                `${item.card.setName}${item.card.number ? ` · ${displayCardNumber(item.card)}` : ""}`
              : (item.error ?? "Reading card")}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {price != null && (
            <span className="text-sm font-semibold text-emerald-400">
              ${price.toFixed(2)}
            </span>
          )}
          <StatusChip status={item.status} />
        </span>
      </button>

      <button
        onClick={onRemove}
        aria-label={`Remove ${item.card ? item.card.englishName || item.card.name : "card"}`}
        className="shrink-0 rounded-md p-2 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-300 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
