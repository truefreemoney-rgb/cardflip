"use client";

import { ebaySearchUrl, withEpnParams } from "@/lib/listing";
import type { PokemonCard } from "@/lib/types";

const EPN_CAMPAIGN_ID = process.env.NEXT_PUBLIC_EBAY_EPN_CAMPAIGN_ID ?? "";

/**
 * "Buy on eBay": eBay's search for this exact card, Best Match (Chris 10-14: not
 * cheapest first), as an EPN link once the campaign id is set. One look for the
 * Watchlist row, the Search tile and the card sheet; `customId` says which one sold.
 */
export default function BuyOnEbayLink({
  card,
  customId,
  className = "",
  label = "Buy on eBay",
  solid = false,
}: {
  card: PokemonCard;
  customId: string;
  className?: string;
  label?: string;
  /** Marketplace blue, filled (the 10-14 Search rows and the card sheet's bottom bar). */
  solid?: boolean;
}) {
  return (
    <a
      href={withEpnParams(ebaySearchUrl(card), EPN_CAMPAIGN_ID, customId)}
      target="_blank"
      rel={EPN_CAMPAIGN_ID ? "noopener noreferrer sponsored" : "noopener noreferrer"}
      onClick={(e) => e.stopPropagation()}
      className={
        solid
          ? `flex items-center justify-center bg-ebay text-center font-semibold text-white transition hover:bg-ebay-hover ${className}`
          : `rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-center text-xs font-semibold text-brand-300 transition hover:bg-brand-500/20 ${className}`
      }
    >
      {label}
    </a>
  );
}
