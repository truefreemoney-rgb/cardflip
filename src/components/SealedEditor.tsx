"use client";

import CardImage from "@/components/CardImage";
import { belowFloor, floorRefusal, listingFloor } from "@/lib/fees";
import { toast } from "@/components/Toaster";
import ListedPanel from "@/components/ListedPanel";
import SoldPanel from "@/components/SoldPanel";
import EbayPostActions from "@/components/EbayPostActions";
import ListingCopyFields from "@/components/ListingCopyFields";
import PriceInput from "@/components/PriceInput";
import {
  buildSealedListing,
  ebaySearchUrl,
  ebaySoldSearchUrl,
  withListingOverrides,
} from "@/lib/listing";
import { updateServerCard } from "@/lib/client/cardsApi";
import { apiPath } from "@/lib/client/basePath";
import { askingPriceFor, formatMoney } from "@/lib/listing";
import type { ScanItem } from "@/lib/types";
import { useEffect, useState } from "react";

interface SealedQuote {
  market: number | null;
  products: { productId: number; name: string; market: number | null; exclusive: boolean }[];
}
type QuoteState = { status: "loading" } | { status: "none" } | { status: "ok"; quote: SealedQuote };

interface Props {
  item: ScanItem;
  /** Whether the signed-in seller has linked an eBay account (drives posting). */
  ebayConnected: boolean;
  onChange: (patch: Partial<ScanItem>) => void;
}

/**
 * The editing pane for sealed product. Deliberately smaller than CardEditor:
 * there's no condition scale, no printing variants, no grading. The price
 * comes from the TCGplayer sealed feed (Tier 2 #13: /api/sealed/price, the
 * median of the set's products of this kind) when the feed has the set,
 * else the seller prices it against the eBay links; everything else is the
 * same list-and-track flow cards get.
 */
export default function SealedEditor({ item, ebayConnected, onChange }: Props) {
  const product = item.card;
  const setName = product?.setName ?? "";
  const productType = item.productType ?? "";
  const game = item.game;
  // A sealed item's set and kind never change, so the state starts where
  // the fetch will leave it and the effect only lands the answer.
  const [quote, setQuote] = useState<QuoteState>(() => ({ status: setName && productType ? "loading" : "none" }));
  useEffect(() => {
    if (!setName || !productType) return;
    let cancelled = false;
    fetch(apiPath(`/api/sealed/price?set=${encodeURIComponent(setName)}&type=${encodeURIComponent(productType)}&game=${game}`))
      .then((r) => (r.ok ? (r.json() as Promise<SealedQuote>) : null))
      .then((q) => {
        if (cancelled) return;
        setQuote(q && q.market != null ? { status: "ok", quote: q } : { status: "none" });
      })
      .catch(() => {
        if (!cancelled) setQuote({ status: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [setName, productType, game]);

  // Market lands and the seller has not priced it: the asking price the
  // feed implies becomes the price, unlocked, the way a card's quote does —
  // so the row is priced in Inventory before anyone types (and the live
  // refresh keeps moving it until the seller sets a number).
  const market = quote.status === "ok" ? quote.quote.market : null;
  const serverId = item.serverId;
  const unpriced = item.priceOverride == null;
  useEffect(() => {
    if (market == null || !unpriced) return;
    const asking = askingPriceFor(market, "Factory Sealed");
    if (!(asking > 0)) return;
    onChange({ priceOverride: asking });
    if (serverId) void updateServerCard(serverId, { price: asking });
    // onChange is a fresh closure every render; the guard above is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, unpriced, serverId]);

  if (!product) return null;

  if (item.status === "listed") return <ListedPanel item={item} onChange={onChange} />;
  if (item.status === "sold") return <SoldPanel item={item} />;

  const price = item.priceOverride ?? 0;
  const setPrice = (n: number) => {
    onChange({ priceOverride: n });
    if (item.serverId) void updateServerCard(item.serverId, { price: n, priceLocked: true });
  };
  const generated = buildSealedListing(product, price, item.productType);
  const listing = withListingOverrides(generated, item);

  return (
    // Same as CardEditor: no overflow container below lg, so the publish
    // row's sticky bar can pin to the viewport on a phone.
    <div className="flex h-full flex-col gap-6 p-6 sm:p-8 lg:overflow-y-auto">
      <div className="flex flex-col gap-5 sm:flex-row">
        <CardImage
          src={product.imageLarge || product.imageSmall}
          alt={product.name}
          className="h-32 w-52 shrink-0 self-start rounded-xl object-contain shadow-2xl shadow-black/50"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-white">{product.name}</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            {product.setName}
            {item.productType && ` · ${item.productType}`}
          </p>
          <span className="mt-2 inline-block rounded-full bg-amber-400/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
            Factory Sealed
          </span>
        </div>
      </div>

      {quote.status === "ok" ? (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-300/80">TCGplayer market</p>
              <p className="font-display text-2xl font-semibold text-emerald-300">{formatMoney(quote.quote.market!)}</p>
            </div>
            {Math.abs(price - askingPriceFor(quote.quote.market!, "Factory Sealed")) >= 0.005 && (
              <button
                type="button"
                onClick={() => setPrice(askingPriceFor(quote.quote.market!, "Factory Sealed"))}
                className="rounded-full bg-emerald-400 px-4 py-2 text-xs font-semibold text-black transition hover:bg-emerald-300"
              >
                Use market price
              </button>
            )}
          </div>
          {quote.quote.products.length > 1 && (
            <ul className="mt-2 space-y-1 border-t border-emerald-400/15 pt-2">
              {quote.quote.products.map((p) => (
                <li key={p.productId} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-zinc-300">
                    {p.name}
                    {p.exclusive && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-300/80">exclusive</span>}
                  </span>
                  {p.market != null ? (
                    <button
                      type="button"
                      onClick={() => setPrice(askingPriceFor(p.market!, "Factory Sealed"))}
                      className="shrink-0 font-medium text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200"
                      title="Price it as this one"
                    >
                      {formatMoney(p.market)}
                    </button>
                  ) : (
                    <span className="shrink-0 text-zinc-600">—</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : quote.status === "none" ? (
        <p className="rounded-lg bg-sky-400/10 px-3 py-2 text-xs leading-snug text-sky-300">
          No TCGplayer price for this one yet — check what it&apos;s actually
          going for with the eBay links below, then set your price.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <a
          href={ebaySoldSearchUrl(product, { sealed: true })}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-ebay px-4 py-2 text-xs font-semibold text-white transition hover:bg-ebay-hover"
        >
          View Sold on eBay
        </a>
        <a
          href={ebaySearchUrl(product, { sealed: true })}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-edge px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-surface-2"
        >
          View Current Listings
        </a>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
        Your price
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
            $
          </span>
          <PriceInput
            value={price}
            onValue={(n) => onChange({ priceOverride: n })}
            // A typed price is the seller's: synced to the ledger locked, so
            // the live refresh leaves it alone (the feed's own default above
            // syncs unlocked).
            onCommit={(n) => {
              // Never under the fee floor (Chris, 09-08): lift it and say so.
              const floor = listingFloor();
              if (belowFloor(n)) {
                onChange({ priceOverride: floor });
                toast(floorRefusal(), "err");
                n = floor;
              }
              if (item.serverId) void updateServerCard(item.serverId, { price: n, priceLocked: true });
            }}
            className="w-full rounded-lg border border-edge bg-black/40 py-2.5 pl-6 pr-3 text-sm text-white outline-none transition focus:border-brand-400"
          />
        </div>
      </label>

      <ListingCopyFields item={item} generated={generated} listing={listing} onChange={onChange} />

      <EbayPostActions
        item={item}
        listing={listing}
        price={price}
        ebayConnected={ebayConnected}
        onChange={onChange}
      />
    </div>
  );
}
