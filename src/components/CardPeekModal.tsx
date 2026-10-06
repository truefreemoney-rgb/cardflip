"use client";

import { displayCardNumber } from "@/lib/games";
import Link from "next/link";
import HoloCard from "@/components/HoloCard";
import PriceHistoryChart from "@/components/PriceHistoryChartLazy";
import { cardTrend } from "@/lib/client/priceHistoryData";
import Sheet from "@/components/Sheet";
import { formatMoney, pickPrice } from "@/lib/listing";
import { PriceFlagText } from "@/components/PriceFlagNote";
import type { PokemonCard } from "@/lib/types";

interface Props {
  card: PokemonCard;
  onClose: () => void;
}

/**
 * Public, logged-out card peek for the landing page: the card in 3D with its
 * live market price and a conversion CTA. Deliberately leaner than the app's
 * CardDetailModal, which assumes an authenticated session (wishlist save).
 * Sheet portals to <body>, so the marquee/sheen tiles that open it (mask-image,
 * overflow:hidden) can't clip it.
 */
export default function CardPeekModal({ card, onClose }: Props) {
  const price = pickPrice(card);

  return (
    <Sheet
      label={`${card.name} details`}
      onClose={onClose}
      backId="card-peek"
      padded={false}
      bodyClassName="p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-8"
    >
      <div className="mx-auto w-48 sm:w-56">
        <HoloCard
          src={card.imageLarge || card.imageSmall}
          alt={`${card.name} — ${card.setName}`}
        />
      </div>

      <div className="mt-6 text-center">
        <h2 className="font-display text-xl font-semibold text-white">
          {card.name}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {card.setName} · {card.game === "mtg" ? displayCardNumber(card) : `#${card.number}`}
        </p>
        {price?.untrusted && (
          <p className="mt-3 text-sm"><PriceFlagText /></p>
        )}
        {price && !price.untrusted && (
          <p className="mt-3">
            <span className="holo-text font-display text-3xl font-bold">
              {formatMoney(price.market ?? 0, price.currency)}
            </span>
            <span className="ml-2 text-xs text-zinc-500">
              Market price
            </span>
          </p>
        )}
      </div>

      {/* Same 90-day history the app shows — the landing page proves the data
          exists rather than describing it. Public route, no session needed. */}
      <PriceHistoryChart
        cardId={card.id}
        preferVariant={price?.variant ?? null}
        trend={cardTrend(card)}
        compact
        className="mt-5 text-left"
      />

      <p className="mt-5 text-center text-sm text-zinc-400">
        Got one of these? Scan it and it&apos;s priced, written up and ready
        for eBay in seconds.
      </p>

      <div className="mt-5 flex flex-col items-stretch gap-3">
        <Link
          href="/signup"
          className="sheen rounded-full bg-brand-500 px-7 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
        >
          Price Your Cards Free
        </Link>
      </div>
    </Sheet>
  );
}
