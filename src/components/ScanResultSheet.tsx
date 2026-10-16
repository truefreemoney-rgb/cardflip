"use client";

import CardImage from "@/components/CardImage";
import Sheet from "@/components/Sheet";
import { formatMoney, headlinePrice } from "@/lib/listing";
import type { ScanItem } from "@/lib/types";

/**
 * The result card, big (10-16, Chris: "the little pill should be clickable
 * with an expanded view", handle to pull down, Done top right): the card's
 * picture large enough to check the art, its name, set and number, the
 * market price, and the same next steps as the chip.
 */
interface Props {
  item: ScanItem;
  /** What this copy is ("Near Mint · Holofoil"); tapping opens the "This copy" sheet. */
  copy: string;
  onEdit?: () => void;
  onSwap?: () => void;
  onClose: () => void;
}

export default function ScanResultSheet({ item, copy, onEdit, onSwap, onClose }: Props) {
  const card = item.card!;
  const price = headlinePrice(item);
  return (
    <Sheet onClose={onClose} title={card.name} backId="scan-result" doneLabel="Done">
      <div className="mx-auto w-[min(68vw,260px)] overflow-hidden rounded-xl shadow-2xl shadow-black/60 ring-1 ring-white/15">
        <CardImage src={card.imageLarge || card.imageSmall} alt={card.name} className="aspect-[5/7] w-full" />
      </div>
      <p className="mt-3 text-center text-sm leading-snug text-zinc-400">
        {card.setName}
        {card.rarity ? ` · ${card.rarity}` : ""}
        {card.number ? ` · #${card.number}` : ""}
      </p>
      <p className="mt-2 text-center font-display text-3xl font-semibold tabular-nums text-white">
        {price > 0 ? formatMoney(price, "USD") : "No price yet"}
      </p>
      {price > 0 && <p className="text-center text-[10px] uppercase tracking-[0.15em] text-zinc-500">market price</p>}
      <div className="mt-4 flex flex-col gap-2">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex w-full items-center justify-between gap-3 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-white/30"
          >
            <span className="truncate">{copy}</span>
            <span className="shrink-0 text-brand-300">Change</span>
          </button>
        )}
        {onSwap && (
          <button
            type="button"
            onClick={onSwap}
            className="w-full rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-edge-strong hover:text-white"
          >
            Not this card?
          </button>
        )}
      </div>
    </Sheet>
  );
}
