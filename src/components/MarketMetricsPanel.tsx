"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import {
  EBAY_SOLD_VARIANT,
  EBAY_VARIANT,
  formatMoney,
  pickPrice,
} from "@/lib/listing";
import type {
  EbayComps,
  EbayCompsStatus,
  EbayListing,
  EbaySoldStatus,
  PokemonCard,
} from "@/lib/types";

interface Props {
  card: PokemonCard;
  sold: EbayComps | null;
  soldStatus: EbaySoldStatus;
  soldUrl: string | null;
  active: EbayComps | null;
  activeStatus: EbayCompsStatus;
  activeUrl: string;
}

/** eBay comps are always USD — the client discards other currencies. */
function money(value: number | null): string {
  return formatMoney(value, "USD");
}

function formatSoldDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Metric({
  label,
  value,
  detail,
  driving,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  driving: boolean;
  tone?: "default" | "strong";
}) {
  return (
    <div
      className={`rounded-xl border p-3 transition ${
        driving
          ? "border-emerald-400/40 bg-emerald-400/5"
          : "border-edge bg-black/20"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p
        className={`mt-1 font-semibold ${
          tone === "strong" ? "text-lg text-white" : "text-base text-zinc-200"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{detail}</p>
      {driving && (
        <p className="mt-1 text-[10px] font-medium text-emerald-400">
          Setting your price
        </p>
      )}
    </div>
  );
}

function ListingRows({ listings }: { listings: EbayListing[] }) {
  return (
    <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto border-t border-white/5">
      {listings.map((listing) => {
        const soldOn = formatSoldDate(listing.soldAt);
        return (
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
                <span className="block text-[11px] text-zinc-600">
                  {[listing.condition, soldOn && `sold ${soldOn}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-emerald-400">
                ${listing.price.toFixed(2)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Every price signal we have for this card, side by side.
 *
 * The point of showing them together rather than collapsing to one number is
 * the spread: sold well under asking means the asking prices are aspirational,
 * and a seller pricing to actually move the card needs to see that gap.
 */
export default function MarketMetricsPanel({
  card,
  sold,
  soldStatus,
  soldUrl,
  active,
  activeStatus,
  activeUrl,
}: Props) {
  const [showSold, setShowSold] = useState(false);
  const [showActive, setShowActive] = useState(false);

  const driving = pickPrice(card)?.variant ?? null;
  const tcg = card.prices.find(
    (p) => p.source === "tcgplayer" && p.market && p.market > 0,
  );
  const market = card.prices.find(
    (p) => p.source === "cardmarket" && p.market && p.market > 0,
  );

  const soldDetail =
    sold != null
      ? `${sold.count} sale${sold.count === 1 ? "" : "s"} · ${money(sold.low)}–${money(sold.high)}`
      : soldStatus === "unconfigured"
        ? "eBay not connected"
        : soldStatus === "empty"
          ? "No recent sales found"
          : "Needs eBay sold-data access";

  const activeDetail =
    active != null
      ? `${active.count} listing${active.count === 1 ? "" : "s"} · ${money(active.low)}–${money(active.high)}`
      : activeStatus === "loading"
        ? "Checking eBay…"
        : activeStatus === "unconfigured"
          ? "eBay not connected"
          : activeStatus === "empty"
            ? "No comparable listings"
            : "Couldn't reach eBay";

  return (
    <div className="rounded-xl border border-edge bg-surface-1">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <h3 className="text-sm font-semibold text-white">Market value</h3>
        {activeStatus === "loading" && (
          <Spinner className="h-3.5 w-3.5 text-zinc-500" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 pt-2.5 sm:grid-cols-4">
        <Metric
          label="eBay sold (90d)"
          value={money(sold?.average ?? null)}
          detail={soldDetail}
          driving={driving === EBAY_SOLD_VARIANT}
          tone="strong"
        />
        <Metric
          label="eBay asking"
          value={money(active?.average ?? null)}
          detail={activeDetail}
          driving={driving === EBAY_VARIANT}
        />
        <Metric
          label="TCGplayer"
          value={formatMoney(tcg?.market ?? null, tcg?.currency)}
          detail={tcg ? tcg.label : "No price for this card"}
          driving={driving === tcg?.variant && tcg != null}
        />
        <Metric
          label="Cardmarket"
          value={formatMoney(market?.market ?? null, market?.currency)}
          // Euros, and never the basis for the dollar listing price — say so
          // rather than letting a number that looks comparable sit next to
          // three that are.
          detail={
            market
              ? "EU market · reference only, not used for pricing"
              : "No price for this card"
          }
          driving={false}
        />
      </div>

      {sold && active && sold.average > 0 && (
        <p className="px-4 pb-3 text-[11px] leading-snug text-zinc-500">
          Cards are selling for{" "}
          <span className="font-medium text-zinc-300">
            {Math.abs(Math.round((1 - sold.average / active.average) * 100))}%{" "}
            {sold.average < active.average ? "below" : "above"}
          </span>{" "}
          what sellers are asking — price against the sold number if you want it
          to move.
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-white/5 px-4 py-3">
        {soldUrl && (
          <a
            href={soldUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-ebay px-4 py-2 text-xs font-semibold text-white transition hover:bg-ebay-hover"
          >
            View sold on eBay
          </a>
        )}
        <a
          href={activeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-edge px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-surface-2"
        >
          View current listings
        </a>
      </div>

      {sold && sold.listings.length > 0 && (
        <>
          <button
            onClick={() => setShowSold((v) => !v)}
            className="w-full border-t border-white/5 px-4 py-2 text-left text-xs text-brand-300 transition hover:text-brand-200"
            aria-expanded={showSold}
          >
            {showSold
              ? "Hide the sales behind this price"
              : `Show the ${sold.listings.length} sale${
                  sold.listings.length === 1 ? "" : "s"
                } behind this price`}
          </button>
          {showSold && <ListingRows listings={sold.listings} />}
        </>
      )}

      {active && active.listings.length > 0 && (
        <>
          <button
            onClick={() => setShowActive((v) => !v)}
            className="w-full border-t border-white/5 px-4 py-2 text-left text-xs text-brand-300 transition hover:text-brand-200"
            aria-expanded={showActive}
          >
            {showActive
              ? "Hide current listings"
              : `Show ${active.listings.length} current listing${
                  active.listings.length === 1 ? "" : "s"
                }`}
          </button>
          {showActive && <ListingRows listings={active.listings} />}
        </>
      )}

      {(sold?.sampled ?? 0) + (active?.sampled ?? 0) >
        (sold?.count ?? 0) + (active?.count ?? 0) && (
        <p className="border-t border-white/5 px-4 py-2 text-[11px] text-zinc-600">
          Bulk lots, graded slabs, and off-market outliers were filtered out —
          they don&apos;t reflect what a single raw card is worth.
        </p>
      )}
    </div>
  );
}
