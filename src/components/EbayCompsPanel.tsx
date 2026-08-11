"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import type { EbayComps, EbayCompsStatus } from "@/lib/types";

interface Props {
  comps: EbayComps | null;
  status: EbayCompsStatus;
  /** Where to send the seller when there are no comps to show. */
  fallbackUrl: string;
}

function EbayButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 rounded-full bg-ebay px-4 py-2 text-xs font-semibold text-white transition hover:bg-ebay-hover"
    >
      {children}
    </a>
  );
}

/**
 * What the card is actually going for on eBay right now. The seller is about
 * to list here, so the number matters less than being able to click through
 * and see the listings it came from — hence the always-present link out.
 */
export default function EbayCompsPanel({ comps, status, fallbackUrl }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-edge bg-surface-1 px-4 py-3 text-sm text-zinc-400">
        <Spinner className="h-3.5 w-3.5" />
        Checking eBay for what this card is selling for…
      </div>
    );
  }

  if (!comps || status !== "done") {
    const message =
      status === "unconfigured"
        ? "eBay pricing isn't connected yet — pricing is using card-market data."
        : status === "empty"
          ? "No comparable eBay listings found for this exact card."
          : status === "error"
            ? "Couldn't reach eBay just now — pricing is using card-market data."
            : "eBay pricing hasn't run for this card yet.";

    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface-1 px-4 py-3">
        <p className="text-sm text-zinc-400">{message}</p>
        <EbayButton href={fallbackUrl}>Search eBay</EbayButton>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-edge bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold text-white">
              ${comps.average.toFixed(2)}
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              eBay average
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {comps.count} comparable listing{comps.count === 1 ? "" : "s"} ·
            ${comps.low.toFixed(2)}–${comps.high.toFixed(2)} · median $
            {comps.median.toFixed(2)}
          </p>
        </div>
        <EbayButton href={comps.searchUrl}>View on eBay</EbayButton>
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full border-t border-white/5 px-4 py-2 text-left text-xs text-brand-300 transition hover:text-brand-200"
        aria-expanded={expanded}
      >
        {expanded
          ? "Hide the listings behind this price"
          : `Show the ${comps.listings.length} listing${
              comps.listings.length === 1 ? "" : "s"
            } behind this price`}
      </button>

      {expanded && (
        <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto border-t border-white/5">
          {comps.listings.map((listing) => (
            <li key={listing.id}>
              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/5"
              >
                {listing.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={listing.imageUrl}
                    alt=""
                    className="h-10 w-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-10 w-8 shrink-0 rounded bg-white/5" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-zinc-300">
                    {listing.title}
                  </span>
                  {listing.condition && (
                    <span className="block text-[11px] text-zinc-600">
                      {listing.condition}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold text-emerald-400">
                  ${listing.price.toFixed(2)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {comps.sampled > comps.count && (
        <p className="border-t border-white/5 px-4 py-2 text-[11px] text-zinc-600">
          Filtered out {comps.sampled - comps.count} of {comps.sampled} results —
          bulk lots, graded slabs, and off-market outliers don&apos;t reflect
          what a single raw card sells for.
        </p>
      )}
    </div>
  );
}
