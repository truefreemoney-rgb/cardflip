"use client";

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { toast } from "@/components/Toaster";
import Spinner from "@/components/Spinner";
import HoloCard from "@/components/HoloCard";
import { addToWishlist } from "@/lib/client/wishlistApi";
import { formatMoney, pickPrice, plausiblePrices } from "@/lib/listing";
import PriceHistoryChart, { cardTrend } from "@/components/PriceHistoryChart";
import { displayCardNumber } from "@/lib/games";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

interface Props {
  card: PokemonCard;
  language: ScanLanguage;
  logging: boolean;
  /** True when opened from the watchlist itself — offering "Add to
   * watchlist" for a card that's already on it is noise. */
  onWatchlist?: boolean;
  /** Watchlist-owned controls (the price-alert editor) rendered under the
   * "On your watchlist" badge — the modal doesn't know wishlist rows. */
  watchlistControls?: React.ReactNode;
  onClose: () => void;
}

/**
 * A dedicated view for one card, layered over the search results rather than
 * expanding inline — clicking a thumbnail should feel like stepping into a
 * focused space to inspect that card, not just growing the same page.
 */
export default function CardDetailModal({ card, language, logging, onWatchlist = false, watchlistControls, onClose }: Props) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const price = pickPrice(card)?.market ?? null;
    const result = await addToWishlist(card, language, price);
    setSaving(false);
    if (result) {
      setSaved(true);
      toast(`${card.name} added to your watchlist`);
    } else {
      toast("Couldn't save to watchlist — try again", "err");
    }
  }

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

  const hasImage = Boolean(card.imageLarge || card.imageSmall);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  return (
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
        className="relative my-auto w-full max-w-2xl rounded-2xl border border-edge bg-surface-1 p-6 shadow-2xl shadow-black/60 outline-none sm:p-8"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/5 hover:text-white"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
          </svg>
        </button>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="mx-auto w-full max-w-[240px] shrink-0 sm:mx-0">
            <HoloCard
              src={card.imageLarge || card.imageSmall}
              alt={card.name}
              className="aspect-[5/7] w-full"
            />
            {hasImage && (
              <p className="mt-2 text-center text-[11px] text-zinc-600">
                Move your cursor over the card
              </p>
            )}
          </div>

          <div className="flex-1 pt-1">
            <h2 className="text-xl font-semibold text-white">{card.name}</h2>
            {card.englishName && (
              <p className="text-sm font-medium text-brand-300">
                {card.englishName}
              </p>
            )}
            <p className="text-sm text-zinc-500">
              {card.setName} · {displayCardNumber(card)}
              {card.isSecretRare ? " · Secret rare" : ""}
              {card.rarity ? ` · ${card.rarity}` : ""}
            </p>
            {logging && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                <Spinner className="h-3 w-3" /> Saving to history…
              </p>
            )}

            {onWatchlist ? (
              <>
                <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-400">
                  ★ On your watchlist
                </p>
                {watchlistControls && <div className="mt-3">{watchlistControls}</div>}
              </>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving || saved}
                className={`mt-4 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-default ${
                  saved
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-white/5 text-zinc-200 hover:bg-white/10"
                }`}
              >
                {saving && <Spinner className="h-3.5 w-3.5" />}
                {saved ? "★ Saved to watchlist" : "☆ Add to watchlist"}
              </button>
            )}
          </div>
        </div>

        <PriceHistoryChart
          cardId={card.id}
          preferVariant={pickPrice(card)?.variant ?? null}
          trend={cardTrend(card)}
          className="mt-6"
        />

        <div className="mt-4 overflow-x-auto">
          {card.prices.length === 0 ? (
            <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
              No price data available for this card from any source.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium">Variant</th>
                  <th className="py-2 pr-4 text-right font-medium">Low</th>
                  <th className="py-2 text-right font-medium">Market</th>
                </tr>
              </thead>
              <tbody>
                {plausiblePrices(card.prices).map((p, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-4 capitalize text-zinc-300">{p.source}</td>
                    <td className="py-2 pr-4 text-zinc-400">{p.label}</td>
                    <td className="py-2 pr-4 text-right text-zinc-400">
                      {formatMoney(p.low, p.currency)}
                    </td>
                    <td className="py-2 text-right font-semibold text-emerald-400">
                      {formatMoney(p.market, p.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
