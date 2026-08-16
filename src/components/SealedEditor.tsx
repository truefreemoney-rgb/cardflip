"use client";

import CardImage from "@/components/CardImage";
import ListedPanel from "@/components/ListedPanel";
import SoldPanel from "@/components/SoldPanel";
import EbayPostActions from "@/components/EbayPostActions";
import {
  buildSealedListing,
  ebaySearchUrl,
  ebaySoldSearchUrl,
} from "@/lib/listing";
import { updateServerCard } from "@/lib/client/cardsApi";
import type { ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  /** Whether the signed-in seller has linked an eBay account (drives posting). */
  ebayConnected: boolean;
  onChange: (patch: Partial<ScanItem>) => void;
}

/**
 * The editing pane for sealed product. Deliberately smaller than CardEditor:
 * there's no condition scale, no printing variants, no grading, and no
 * catalogue price for a booster box — the seller prices it against the eBay
 * links and everything else is the same list-and-track flow cards get.
 */
export default function SealedEditor({ item, ebayConnected, onChange }: Props) {
  const product = item.card;
  if (!product) return null;

  if (item.status === "listed") return <ListedPanel item={item} onChange={onChange} />;
  if (item.status === "sold") return <SoldPanel item={item} />;

  const price = item.priceOverride ?? 0;
  const listing = buildSealedListing(product, price, item.productType);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6 sm:p-8">
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

      <p className="rounded-lg bg-sky-400/10 px-3 py-2 text-xs leading-snug text-sky-300">
        Sealed product has no card-market price feed — check what it&apos;s
        actually going for with the eBay links below, then set your price.
      </p>

      <div className="flex flex-wrap gap-2">
        <a
          href={ebaySoldSearchUrl(product, { sealed: true })}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-ebay px-4 py-2 text-xs font-semibold text-white transition hover:bg-ebay-hover"
        >
          View sold on eBay
        </a>
        <a
          href={ebaySearchUrl(product, { sealed: true })}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-edge px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-surface-2"
        >
          View current listings
        </a>
      </div>

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
            // Cards sync their ledger price when the initial quote and eBay
            // comps land; sealed product has neither, so without this a
            // priced draft would sit at $0 in My Cards until listed.
            onBlur={() => {
              if (item.serverId) void updateServerCard(item.serverId, { price });
            }}
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
