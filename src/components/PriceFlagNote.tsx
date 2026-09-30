import { PRICE_FLAG_LINK, PRICE_FLAG_NOTE } from "@/lib/priceFlag";

/**
 * What every screen shows in place of a market price the price guard does not
 * believe (lib/server/priceTrustSite.ts): one sentence, one link, so the
 * scanner, the editor, the detail modal, the tiles and the collection all say
 * the same words. The amber matches the existing "no market price" note.
 *
 * `PriceFlagNote` is the block for a panel (editor, sheets); `PriceFlagText` is
 * the inline sentence for a tile or a table cell. The link goes to the card's
 * eBay sold listings where the page already has that search.
 */
export function PriceFlagText({ className = "" }: { className?: string }) {
  return <span className={`text-amber-300 ${className}`}>{PRICE_FLAG_NOTE}</span>;
}

export default function PriceFlagNote({
  soldUrl,
  hint,
  className = "",
}: {
  /** The card's eBay sold-listings search, when the page has one. */
  soldUrl?: string | null;
  /** A second sentence, e.g. "Set your own price below." */
  hint?: string;
  className?: string;
}) {
  return (
    <p className={`rounded-lg bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-300 ${className}`}>
      {PRICE_FLAG_NOTE}.{hint ? ` ${hint}` : ""}
      {soldUrl && (
        <>
          {" "}
          <a href={soldUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2 transition hover:text-amber-200">
            {PRICE_FLAG_LINK}
          </a>
        </>
      )}
    </p>
  );
}
