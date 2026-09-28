"use client";

import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { useBackToClose } from "@/lib/client/useBackToClose";
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { toast } from "@/components/Toaster";
import Spinner from "@/components/Spinner";
import HoloCard from "@/components/HoloCard";
import { MatchHero } from "@/components/CenteringPhoto";
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
  /** The catalog row is still on its way — show the card now, prices shortly. */
  loading?: boolean;
  /** Owner-supplied panel beside the card — Inventory puts the row's
   * status, price, facts and actions here (09-04). */
  aside?: React.ReactNode;
  /** The seller's own photo of this copy, shown on the stage behind a
   * Match / Your Photo switch (same hero as the listing screen). */
  photo?: string | null;
  /** Run the centering read on the photo (Pokémon only). */
  centering?: boolean;
  /** Sealed product (box, ETB, tin): landscape art, shown whole. */
  sealed?: boolean;
  onClose: () => void;
}

/**
 * A dedicated view for one card, layered over the page. Makeover 09-28
 * (Chris: "needs a total redesign"): the old version was a full-width card
 * image with loose blocks stacked under it. Now it is an app sheet — a
 * sticky title bar, the lit stage from the listing screen (one card, Match /
 * Your Photo switch), the copy's own panel beside it, and the market data
 * grouped under one heading. Phones get the whole screen; desktop keeps a
 * centred dialog.
 */
export default function CardDetailModal({
  card,
  language,
  logging,
  onWatchlist = false,
  watchlistControls,
  loading = false,
  aside,
  photo,
  centering = false,
  sealed = false,
  onClose,
}: Props) {
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
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useBodyScrollLock();
  useBackToClose("card-detail", onClose);

  const hasImage = Boolean(card.imageLarge || card.imageSmall);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const usdPrices = plausiblePrices(card.prices).filter((p) => p.currency === "USD");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:overflow-y-auto sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name} details`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up panel-solid flex h-full w-full flex-col overflow-hidden outline-none sm:my-auto sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-2xl sm:border sm:shadow-2xl sm:shadow-black/70"
      >
        {/* Title bar: the name is the title, the set is the subtitle. */}
        <header className="flex items-start gap-3 border-b border-edge px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 font-display text-lg font-semibold leading-tight text-white sm:text-xl">{card.name}</h2>
            {card.englishName && <p className="truncate text-sm font-medium text-brand-300">{card.englishName}</p>}
            <p className="truncate text-xs text-zinc-500 sm:text-sm">
              {[card.setName, displayCardNumber(card), card.isSecretRare ? "Secret rare" : "", card.rarity ?? ""]
                .filter((s) => s && s.trim())
                .join(" · ")}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div className="w-full shrink-0 sm:w-64">
              <MatchHero
                photoSrc={photo ?? null}
                centering={centering}
                match={
                  hasImage && sealed ? (
                    // Box and tin art is landscape: show all of it on a blurred
                    // wash instead of cropping it into a card shape.
                    <div className="absolute inset-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={card.imageLarge || card.imageSmall} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-xl" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={card.imageLarge || card.imageSmall} alt={card.name} className="absolute inset-0 h-full w-full object-contain p-2" />
                    </div>
                  ) : hasImage ? (
                    <HoloCard src={card.imageLarge || card.imageSmall} alt={card.name} className="aspect-[5/7] w-full" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 border border-dashed border-edge-strong px-3 text-center">
                      <p className="text-sm font-medium text-zinc-300">{card.name}</p>
                      <p className="text-xs text-zinc-500">No catalogue art for this printing</p>
                    </div>
                  )
                }
              />
              {hasImage && !photo && (
                <p className="mt-2 hidden text-center text-[11px] text-zinc-600 [@media(hover:hover)]:block">
                  Move your cursor over the card
                </p>
              )}
            </div>

            <div className="min-w-0 flex-1">
              {logging && (
                <p className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
                  <Spinner className="h-3 w-3" /> Saving to history…
                </p>
              )}

              {aside}

              {onWatchlist ? (
                <>
                  <p className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-400">
                    ★ On your watchlist
                  </p>
                  {watchlistControls && <div className="mt-3">{watchlistControls}</div>}
                </>
              ) : (
                <button
                  onClick={handleSave}
                  // Not while the catalog row is still loading: the stub has no
                  // prices and a save then landed with none (09-08).
                  disabled={saving || saved || loading}
                  className={`flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-default ${aside ? "mt-3 w-full sm:w-auto" : "w-full sm:w-auto"} ${
                    saved ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-zinc-200 hover:bg-white/10"
                  }`}
                >
                  {saving && <Spinner className="h-3.5 w-3.5" />}
                  {saved ? "★ Saved to watchlist" : "☆ Add to watchlist"}
                </button>
              )}
            </div>
          </div>

          {/* Market: the history chart and today's table, one section. */}
          <section className="mt-5 border-t border-edge pt-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Market</h3>
            <PriceHistoryChart
              cardId={card.id}
              preferVariant={pickPrice(card)?.variant ?? null}
              trend={cardTrend(card)}
              className="mt-2"
            />
            <div className="mt-3 overflow-x-auto">
              {loading && card.prices.length === 0 ? (
                <p className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                  <Spinner className="h-3 w-3" /> Loading current prices…
                </p>
              ) : usdPrices.length === 0 ? (
                <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                  No current price table from TCGplayer for this printing.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-[10px] uppercase tracking-wide text-zinc-500">
                      <th className="py-2 pr-4 font-medium">Source</th>
                      <th className="py-2 pr-4 font-medium">Variant</th>
                      <th className="py-2 pr-4 text-right font-medium">Low</th>
                      <th className="py-2 text-right font-medium">Market</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* USD only (Chris, 09-08: "we aren't going to be using euros yet"). */}
                    {usdPrices.map((p, i) => (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="py-2 pr-4 capitalize text-zinc-300">{p.source}</td>
                        <td className="py-2 pr-4 text-zinc-400">{p.label}</td>
                        <td className="py-2 pr-4 text-right text-zinc-400">{formatMoney(p.low, p.currency)}</td>
                        <td className="py-2 text-right font-semibold text-emerald-400">{formatMoney(p.market, p.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
