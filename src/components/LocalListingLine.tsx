"use client";

import { useEffect, useState } from "react";
import Price from "@/components/Price";
import { fetchLocalAsk, quoteLocalListing, useLocalMarket, type ServerLocalAsk } from "@/lib/client/localMarket";
import { formatLocalAmount, marketplaceLabel } from "@/lib/marketplaces";
import type { PriceStrategy } from "@/lib/types";

/**
 * "£3.99 on eBay UK", with the USD market price underneath, for a seller whose
 * listings go to a local eBay site. Renders nothing for a US seller (the hook
 * never even asks the server for them), so every editor can drop it in.
 *
 * Two modes:
 *  - `cardId`: the number is the SERVER's own answer for that card
 *    (/api/ebay/market, the same code the push runs), so what is shown is by
 *    construction what gets listed. `refreshKey` changes whenever anything the
 *    price depends on changes in the editor; the lookup is debounced.
 *  - `typedUsd` (the reprice sheet, where the price is always the seller's
 *    own): a pure conversion by the same rule (pickLocalAsk).
 */
export default function LocalListingLine({
  cardId,
  strategy,
  refreshKey,
  typedUsd,
  condition,
  usd,
  className = "",
}: {
  cardId?: string | null;
  strategy?: PriceStrategy;
  refreshKey?: string;
  typedUsd?: number | null;
  condition?: string;
  /** The USD figure shown underneath (market price, or the seller's own). */
  usd?: number | null;
  className?: string;
}) {
  const info = useLocalMarket();
  const [ask, setAsk] = useState<ServerLocalAsk | null>(null);
  useEffect(() => {
    if (!info || !cardId) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void fetchLocalAsk(cardId, strategy ?? "market").then((a) => alive && setAsk(a));
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [info, cardId, strategy, refreshKey]);

  if (!info) return null;
  const site = marketplaceLabel(info.mp);
  if (!info.rate) {
    return (
      <p className={`rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 ${className}`}>
        CardFlip&apos;s exchange rate is out of date right now, so it can&apos;t price an {site} listing. Try again in a little while.
      </p>
    );
  }

  let text: string | null = null;
  let floor = 0;
  let error: string | null = null;
  if (cardId) {
    if (ask && "text" in ask) {
      text = ask.text;
      floor = ask.floor;
    } else if (ask) {
      error = ask.error;
    }
  } else if (typedUsd != null) {
    const q = quoteLocalListing(info, { locked: true, priceUsd: typedUsd, condition: condition ?? "Near Mint" });
    if (q) {
      text = q.text;
      floor = q.floor;
    }
  }
  if (error) {
    return <p className={`rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 ${className}`}>{error}</p>;
  }
  if (!text) return null;
  const shown = usd ?? typedUsd ?? null;
  return (
    <div className={`rounded-lg border border-edge bg-surface-1 px-3 py-2 ${className}`}>
      <p className="text-sm text-zinc-300">
        <span className="font-display text-base font-semibold text-white">{text}</span> on {site}
      </p>
      {shown != null && shown > 0 && (
        <p className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
          <span>{cardId ? "Market price" : "Your price"}</span>
          <Price usd={shown} className="text-xs font-medium text-zinc-300" />
        </p>
      )}
      <p className="mt-1 text-[11px] text-zinc-500">
        Lowest price {formatLocalAmount(info.mp, floor)} — below that you&apos;d lose money after eBay fees and postage.
      </p>
    </div>
  );
}
