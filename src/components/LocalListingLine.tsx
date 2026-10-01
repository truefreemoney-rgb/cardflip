"use client";

import Price from "@/components/Price";
import { quoteLocalListing, useLocalMarket } from "@/lib/client/localMarket";
import { formatLocalAmount, marketplaceLabel } from "@/lib/marketplaces";
import type { Condition, PriceStrategy } from "@/lib/types";

/**
 * "£3.99 on eBay UK", with the USD market price underneath, for a seller whose
 * listings go to a local eBay site. Renders nothing for a US seller (the hook
 * never even asks the server for them), so every editor can drop it in.
 *
 * The number mirrors what the server will send (see quoteLocalListing); the
 * server still prices the real listing itself at push time.
 */
export default function LocalListingLine({
  typedUsd,
  marketUsd,
  condition,
  strategy,
  className = "",
}: {
  /** The seller's own USD price (they typed or picked it); converts at today's rate. */
  typedUsd?: number | null;
  /** The USD market value of the card (before condition), when it was priced from the market. */
  marketUsd?: number | null;
  condition: Condition | string;
  strategy?: PriceStrategy;
  className?: string;
}) {
  const info = useLocalMarket();
  if (!info) return null;
  const quote = quoteLocalListing(info, { typedUsd, marketUsd, condition, strategy });
  const site = marketplaceLabel(info.mp);
  if (!info.rate) {
    return (
      <p className={`rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 ${className}`}>
        CardFlip&apos;s exchange rate is out of date right now, so it can&apos;t price an {site} listing. Try again in a little while.
      </p>
    );
  }
  if (!quote) return null;
  const usd = marketUsd ?? typedUsd ?? null;
  return (
    <div className={`rounded-lg border border-edge bg-surface-1 px-3 py-2 ${className}`}>
      <p className="text-sm text-zinc-300">
        <span className="font-display text-base font-semibold text-white">{quote.text}</span> on {site}
      </p>
      {usd != null && usd > 0 && (
        <p className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
          <span>{marketUsd != null ? "Market price" : "Your price"}</span>
          <Price usd={usd} className="text-xs font-medium text-zinc-300" />
        </p>
      )}
      <p className="mt-1 text-[11px] text-zinc-500">
        Lowest price {formatLocalAmount(info.mp, quote.floor)} — below that you&apos;d lose money after eBay fees and postage.
      </p>
    </div>
  );
}
