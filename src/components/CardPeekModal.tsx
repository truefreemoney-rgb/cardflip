"use client";

import { displayCardNumber } from "@/lib/games";
import { useEffect, useRef } from "react";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { createPortal } from "react-dom";
import Link from "next/link";
import HoloCard from "@/components/HoloCard";
import DemoButton from "@/components/DemoButton";
import PriceHistoryChart, { cardTrend } from "@/components/PriceHistoryChart";
import { formatMoney, pickPrice } from "@/lib/listing";
import type { PokemonCard } from "@/lib/types";

interface Props {
  card: PokemonCard;
  onClose: () => void;
}

/**
 * Public, logged-out card peek for the landing page: the card in 3D with its
 * live market price and a conversion CTA. Deliberately leaner than the app's
 * CardDetailModal, which assumes an authenticated session (wishlist save).
 */
export default function CardPeekModal({ card, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const price = pickPrice(card);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  // Portal to <body>: the triggers live inside containers with mask-image /
  // overflow:hidden (marquee, sheen tiles), which visually clip a fixed
  // overlay rendered in place.
  return createPortal(
    <div
      className="animate-fade-up fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name} details`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="foil-edge relative my-auto w-full max-w-md rounded-3xl p-6 shadow-2xl shadow-black/60 outline-none [--foil-fill:#0b0d13] sm:p-8"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          autoFocus
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-surface-2 hover:text-white"
        >
          ✕
        </button>

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
          {price && (
            <p className="mt-3">
              <span className="holo-text font-display text-3xl font-bold">
                {formatMoney(price.market ?? 0, price.currency)}
              </span>
              <span className="ml-2 text-xs text-zinc-500">
                TCGplayer market
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
            Price your cards free
          </Link>
          <DemoButton />
        </div>
      </div>
    </div>,
    document.body,
  );
}
