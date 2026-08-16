"use client";

import { useState } from "react";
import CardPeekModal from "@/components/CardPeekModal";
import type { PokemonCard } from "@/lib/types";

/**
 * The scattered "binder page" of real cards in the features bento; each one
 * opens the same public card peek as the ticker.
 */
export default function CardWall({ cards }: { cards: PokemonCard[] }) {
  const [selected, setSelected] = useState<PokemonCard | null>(null);

  if (cards.length < 8) return null;

  return (
    <>
      <div className="mt-6 grid grid-cols-4 gap-2">
        {cards.slice(0, 8).map((card, i) => (
          <button
            key={card.id}
            type="button"
            onClick={() => setSelected(card)}
            aria-label={`${card.name} — ${card.setName}`}
            className={`cursor-pointer transition hover:!rotate-0 hover:scale-105 ${
              i % 2 ? "rotate-2" : "-rotate-2"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.imageSmall}
              alt=""
              loading="lazy"
              className="w-full rounded-md shadow-lg shadow-black/40"
            />
          </button>
        ))}
      </div>

      {selected && (
        <CardPeekModal card={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
