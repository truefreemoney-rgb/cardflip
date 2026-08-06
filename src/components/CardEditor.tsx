"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import ListedPanel from "@/components/ListedPanel";
import SoldPanel from "@/components/SoldPanel";
import CardImage from "@/components/CardImage";
import { searchCards } from "@/lib/cards";
import { addToWishlist } from "@/lib/client/wishlistApi";
import {
  CONDITIONS,
  buildListing,
  ebaySellUrl,
  quotePrice,
} from "@/lib/listing";
import type { Condition, PokemonCard, PriceStrategy, ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  onChange: (patch: Partial<ScanItem>) => void;
}

export default function CardEditor({ item, onChange }: Props) {
  const [copied, setCopied] = useState(false);
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlisting, setWishlisting] = useState(false);

  const card = item.card;

  async function runSearch() {
    if (!term.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await searchCards(term.trim(), null, item.language);
      if (found.length === 0) {
        setSearchError("No cards matched that name.");
      } else {
        onChange({
          candidates: found,
          card: found[0],
          status: found.length === 1 ? "ready" : "review",
          error: null,
        });
        setShowAlternatives(found.length > 1);
      }
    } catch {
      setSearchError("Search failed — check your connection.");
    } finally {
      setSearching(false);
    }
  }

  const manualSearch = (
    <div className="w-full max-w-sm">
      <label
        htmlFor="manual-search"
        className="mb-1.5 block text-sm font-medium text-zinc-300"
      >
        Search by card name
      </label>
      <div className="flex gap-2">
        <input
          id="manual-search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder="e.g. Charizard"
          className="flex-1 rounded-lg border border-edge bg-black/40 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
        />
        <button
          onClick={runSearch}
          disabled={searching}
          className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-60"
        >
          {searching && <Spinner className="h-3.5 w-3.5" />}
          Search
        </button>
      </div>
      {searchError && (
        <p className="mt-2 text-xs text-red-400">{searchError}</p>
      )}
    </div>
  );

  if (item.status === "scanning" || item.status === "queued") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt=""
          className="h-56 w-auto rounded-xl shadow-2xl shadow-black/50"
        />
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Spinner className="h-4 w-4 text-brand-400" />
          {item.status === "scanning" ? "Reading the card…" : "Waiting in queue"}
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt=""
          className="h-40 w-auto rounded-xl opacity-60 shadow-xl shadow-black/40"
        />
        <div>
          <p className="font-medium text-white">
            {item.error ?? "Couldn't identify this card"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Photos work best straight-on, with the name at the top in focus.
          </p>
        </div>
        {manualSearch}
      </div>
    );
  }

  if (item.status === "listed") {
    return <ListedPanel item={item} onChange={onChange} />;
  }

  if (item.status === "sold") {
    return <SoldPanel item={item} />;
  }

  const quote = quotePrice(
    card,
    item.condition,
    item.strategy,
    item.variant ?? undefined,
  );
  const quickQuote = quotePrice(card, item.condition, "quick", item.variant ?? undefined);
  const marketQuote = quotePrice(card, item.condition, "market", item.variant ?? undefined);

  const price = item.priceOverride ?? quote?.suggested ?? 0;
  const listing = buildListing(card, price, item.condition, quote?.price.label);
  const pricedVariants = card.prices.filter((p) => p.market && p.market > 0);

  function copyListing() {
    navigator.clipboard.writeText(
      `${listing.title}\n\n${listing.description}\n\nPrice: $${price.toFixed(2)}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleWishlist() {
    if (!card) return;
    setWishlisting(true);
    const result = await addToWishlist(card, item.language, quote?.base ?? null);
    setWishlisting(false);
    if (result) setWishlisted(true);
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row">
        <CardImage
          src={card.imageLarge || card.imageSmall || item.previewUrl}
          alt={card.name}
          className="h-56 w-auto self-start rounded-xl shadow-2xl shadow-black/50"
        />

        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-white">{card.name}</h2>
          {card.englishName && (
            <p className="text-sm font-medium text-brand-300">
              {card.englishName}
            </p>
          )}
          <p className="mt-0.5 text-sm text-zinc-400">
            {card.setName} · {card.number}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {card.rarity && (
              <span className="rounded-full bg-brand-500/10 px-2.5 py-0.5 text-xs font-medium text-brand-300">
                {card.rarity}
              </span>
            )}
            {quote && (
              <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-zinc-400">
                Market ${quote.base.toFixed(2)} · {quote.price.label}
              </span>
            )}
          </div>

          <button
            onClick={handleWishlist}
            disabled={wishlisting || wishlisted}
            className={`mt-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-default ${
              wishlisted
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            {wishlisting && <Spinner className="h-3 w-3" />}
            {wishlisted ? "★ Saved to wishlist" : "☆ Add to wishlist"}
          </button>

          {item.candidates.length > 1 && (
            <button
              onClick={() => setShowAlternatives((v) => !v)}
              className="mt-3 text-xs text-brand-300 underline underline-offset-4 hover:text-brand-200"
            >
              {showAlternatives
                ? "Hide other matches"
                : `Not this card? ${item.candidates.length - 1} other match${
                    item.candidates.length > 2 ? "es" : ""
                  }`}
            </button>
          )}

          {showAlternatives && (
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
              {item.candidates.map((c: PokemonCard) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onChange({ card: c, status: "ready", priceOverride: null, variant: null });
                    setShowAlternatives(false);
                  }}
                  className={`overflow-hidden rounded-md border transition hover:-translate-y-0.5 ${
                    c.id === card.id
                      ? "border-brand-400"
                      : "border-transparent hover:border-edge-strong"
                  }`}
                  title={`${c.name} — ${c.setName} ${c.number}`}
                >
                  <CardImage
                    src={c.imageSmall}
                    alt={`${c.name}, ${c.setName}`}
                    className="aspect-[5/7] w-full"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!quote && (
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          No market price is available for this card — set your own price below.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
          Condition
          <select
            value={item.condition}
            onChange={(e) =>
              onChange({ condition: e.target.value as Condition, priceOverride: null })
            }
            className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {pricedVariants.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
            Printing
            <select
              value={item.variant ?? quote?.price.variant ?? ""}
              onChange={(e) => onChange({ variant: e.target.value, priceOverride: null })}
              className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
            >
              {pricedVariants.map((p) => (
                <option key={`${p.source}-${p.variant}`} value={p.variant}>
                  {p.label} — ${p.market?.toFixed(2)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {quickQuote && marketQuote && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-zinc-300">
            Pricing
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["quick", "Quick sale", quickQuote.suggested, "Undercuts market to move fast"],
                ["market", "Market price", marketQuote.suggested, "Holds out for full value"],
              ] as [PriceStrategy, string, number, string][]
            ).map(([value, label, amount, hint]) => (
              <button
                key={value}
                onClick={() => onChange({ strategy: value, priceOverride: null })}
                className={`rounded-xl border p-3 text-left transition ${
                  item.strategy === value
                    ? "border-brand-400 bg-brand-500/10"
                    : "border-edge bg-surface-1 hover:border-edge-strong"
                }`}
              >
                <span className="block text-sm font-semibold text-white">
                  ${amount.toFixed(2)}
                </span>
                <span className="block text-xs text-zinc-400">{label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-600">
                  {hint}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
        Your price
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
            $
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) =>
              onChange({ priceOverride: parseFloat(e.target.value) || 0 })
            }
            className="w-full rounded-lg border border-edge bg-black/40 py-2.5 pl-6 pr-3 text-sm text-white outline-none transition focus:border-brand-400"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
        Listing title
        <input
          readOnly
          value={listing.title}
          className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-zinc-200"
        />
        <span className="text-[11px] text-zinc-600">
          {listing.title.length}/80 characters
        </span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
        Description
        <textarea
          readOnly
          value={listing.description}
          className="min-h-36 resize-y rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm leading-relaxed text-zinc-200"
        />
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={ebaySellUrl(listing)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-full bg-ebay px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-ebay-hover"
        >
          Open eBay with this listing
        </a>
        <button
          onClick={copyListing}
          className="flex-1 rounded-full border border-edge px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-surface-2"
        >
          {copied ? "Copied ✓" : "Copy listing text"}
        </button>
      </div>

      <div className="-mt-2 flex flex-col items-center gap-1.5 border-t border-white/5 pt-5">
        <button
          onClick={() =>
            onChange({ status: "listed", listedPrice: price, listedAt: Date.now() })
          }
          className="w-full max-w-xs rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-400"
        >
          I posted this — mark as listed
        </button>
        <p className="text-[11px] text-zinc-600">
          Posting itself still happens on eBay — this just tracks it here.
        </p>
      </div>
    </div>
  );
}
