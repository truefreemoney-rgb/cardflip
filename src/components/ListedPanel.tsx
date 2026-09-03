"use client";

import Link from "next/link";
import CardImage from "@/components/CardImage";
import type { ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  onChange: (patch: Partial<ScanItem>) => void;
  /** Jump to the next card still being worked — for stack sessions. */
  onNext?: (() => void) | null;
}

function timeAgo(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export default function ListedPanel({ item, onChange, onNext }: Props) {
  const card = item.card!;
  const listedPrice = item.listedPrice ?? 0;

  function revert() {
    onChange({ status: "ready", listedPrice: null, listedAt: null });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-6 text-center sm:p-8">
      <div className="flex flex-col items-center gap-4">
        <CardImage
          src={card.imageLarge || card.imageSmall || item.previewUrl}
          alt={card.name}
          className="h-48 w-auto rounded-xl shadow-2xl shadow-black/50"
        />
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ebay/15 px-3 py-1 text-xs font-medium text-sky-300">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            Live on eBay
          </span>
          <h2 className="mt-2 text-lg font-semibold text-white">{card.name}</h2>
          <p className="text-sm text-zinc-500">
            Listed at ${listedPrice.toFixed(2)} ·{" "}
            {item.listedAt ? timeAgo(item.listedAt) : "just now"}
          </p>
          {/* The first thing a seller wants after publishing is to SEE the
              live listing (Chris, 09-02: the old tiny text link buried it). */}
          {item.ebayListingUrl && (
            <a
              href={item.ebayListingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-ebay px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ebay-hover"
            >
              View your listing on eBay ↗
            </a>
          )}
        </div>
      </div>

      {/* The sale records itself when the eBay order comes in (sales sync);
          off-eBay sales are marked in My Cards. So this panel's job after
          publish is just momentum (Chris, 09-02: "list next card at the
          bottom and maybe track card in my cards"). */}
      <div className="flex flex-col items-center gap-3">
        {onNext && (
          <button
            onClick={onNext}
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
          >
            List the next card →
          </button>
        )}
        <p className="max-w-xs text-[11px] leading-snug text-zinc-600">
          When it sells on eBay, it&apos;s marked sold here automatically —
          track it in{" "}
          <Link href="/app/collection" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200">
            Inventory
          </Link>
          .
        </p>
      </div>

      <button
        onClick={revert}
        className="text-xs text-zinc-500 underline underline-offset-4 transition hover:text-zinc-300"
      >
        Not listed after all — back to editing
      </button>
    </div>
  );
}
