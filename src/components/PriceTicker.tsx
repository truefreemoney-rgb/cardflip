"use client";

import { useState } from "react";
import CardPeekModal from "@/components/CardPeekModal";
import type { PokemonCard } from "@/lib/types";

function marketPrice(card: PokemonCard): number | null {
  const prices = card.prices
    .filter((p) => p.source === "tcgplayer")
    .map((p) => p.market ?? 0)
    .filter((n) => n > 0);
  return prices.length ? Math.max(...prices) : null;
}

/**
 * Full-bleed marquee of real cards with real market prices; every chip opens
 * a CardPeekModal. Renders nothing when the showcase fetch came back empty,
 * so the landing page never shows placeholder data.
 */
export default function PriceTicker({
  cards,
  catalogLabel,
}: {
  cards: PokemonCard[];
  /** "115,000+" — computed server-side from the mirrors. */
  catalogLabel?: string;
}) {
  const [selected, setSelected] = useState<PokemonCard | null>(null);

  if (cards.length < 6) return null;

  const anyPriced = cards.some((c) => marketPrice(c) !== null);

  const chips = (hidden: boolean) =>
    cards.map((card) => {
      const price = marketPrice(card);
      return (
        <button
          key={card.id}
          type="button"
          onClick={() => setSelected(card)}
          tabIndex={hidden ? -1 : undefined}
          aria-hidden={hidden || undefined}
          className="mx-2 flex shrink-0 cursor-pointer items-center gap-3 rounded-full border border-edge bg-surface-1 py-1.5 pl-1.5 pr-4 text-left transition hover:border-edge-strong hover:bg-surface-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.imageSmall}
            alt=""
            aria-hidden
            loading="lazy"
            className="h-9 w-7 rounded-[3px] object-cover"
          />
          <span className="leading-tight">
            <span className="block text-xs font-medium text-white">
              {card.name}
            </span>
            <span className="block text-[11px] text-zinc-500">
              {card.setName}
            </span>
          </span>
          {price !== null && (
            <span className="text-sm font-semibold text-emerald-400">
              ${price >= 100
                ? Math.round(price).toLocaleString("en-US")
                : price.toFixed(2)}
            </span>
          )}
        </button>
      );
    });

  return (
    <section aria-label="Live market prices" className="marquee py-4">
      <div className="marquee-track">
        <div className="flex">{chips(false)}</div>
        <div className="flex" aria-hidden>
          {chips(true)}
        </div>
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-500">
        {anyPriced
          ? "Live TCGplayer market prices, straight from the catalog. Tap a card for a closer look."
          : `Straight from the ${catalogLabel ? `${catalogLabel}-printing` : ""} catalog. Tap a card for a closer look.`}
      </p>

      {selected && (
        <CardPeekModal card={selected} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}
