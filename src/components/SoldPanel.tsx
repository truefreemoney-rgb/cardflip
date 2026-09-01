"use client";

import { useState } from "react";
import CardImage from "@/components/CardImage";
import type { ScanItem } from "@/lib/types";

/**
 * eBay's collectibles final value fee is ~13.25% for most sellers as of 2024,
 * plus a flat per-order fee. Shown as a clearly-labeled estimate — actual
 * fees depend on the seller's store tier and category.
 */
const EBAY_FEE_RATE = 0.1325;
const EBAY_FLAT_FEE = 0.3;

function daysBetween(start: number, end: number): string {
  const days = Math.round((end - start) / 86_400_000);
  if (days <= 0) return "the same day";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

interface Props {
  item: ScanItem;
  /** Absent on read-only render sites; the fix-up controls need it. */
  onChange?: (patch: Partial<ScanItem>) => void;
  /** Jump to the next card still being worked — for stack sessions. */
  onNext?: (() => void) | null;
}

export default function SoldPanel({ item, onChange, onNext }: Props) {
  const card = item.card!;
  const salePrice = item.soldPrice ?? 0;
  const fees = salePrice * EBAY_FEE_RATE + EBAY_FLAT_FEE;
  const net = Math.max(0, salePrice - fees);
  // The receipt is not a dead end (Chris, 09-01 QoL pass): the recorded sale
  // price drives the Earned tiles, so a wrong number must be fixable here —
  // and a misclicked "Mark as sold" must be reversible.
  const [editing, setEditing] = useState(false);
  const [draftPrice, setDraftPrice] = useState(salePrice);

  function savePrice() {
    // Re-sending status keeps the ledger sync path (patchItem's sold
    // checkpoint) carrying the corrected price to the server.
    onChange?.({ status: "sold", soldPrice: draftPrice, soldAt: item.soldAt ?? Date.now() });
    setEditing(false);
  }

  function unsell() {
    // Back to where it was before the sale — listed if it was live, draft
    // otherwise. The listed sync clears soldPrice/soldAt on the server.
    if (item.listedAt) {
      onChange?.({ status: "listed", soldPrice: null, soldAt: null });
    } else {
      onChange?.({ status: "ready", soldPrice: null, soldAt: null, listedPrice: null, listedAt: null });
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center sm:p-8">
      <div className="animate-fade-up flex flex-col items-center gap-3">
        <div className="relative">
          <div
            className="absolute -inset-8 rounded-full bg-emerald-500/20 blur-2xl"
            aria-hidden
          />
          <CardImage
            src={card.imageLarge || card.imageSmall || item.previewUrl}
            alt={card.name}
            className="relative h-48 w-auto rounded-xl shadow-2xl shadow-black/50"
          />
          <span
            className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-lg shadow-lg shadow-emerald-500/40"
            aria-hidden
          >
            🎉
          </span>
        </div>

        <div>
          <p className="text-sm font-medium text-emerald-400">Sold</p>
          <h2 className="text-xl font-semibold text-white">{card.name}</h2>
          <p className="text-sm text-zinc-500">
            {item.listedAt && item.soldAt
              ? `Sold ${daysBetween(item.listedAt, item.soldAt)} after listing`
              : "Sold"}
          </p>
        </div>
      </div>

      <div className="w-full max-w-xs rounded-2xl border border-edge bg-surface-1 p-5 text-left">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-zinc-400">Sale price</span>
          {editing ? (
            <span className="flex items-center gap-1.5">
              <span className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  autoFocus
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(parseFloat(e.target.value) || 0)}
                  onKeyDown={(e) => e.key === "Enter" && savePrice()}
                  className="w-24 rounded-md border border-edge bg-black/40 py-1 pl-5 pr-2 text-right text-sm text-white outline-none focus:border-brand-400"
                />
              </span>
              <button
                onClick={savePrice}
                className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
              >
                Save
              </button>
            </span>
          ) : (
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-white">
                ${salePrice.toFixed(2)}
              </span>
              {onChange && (
                <button
                  onClick={() => {
                    setDraftPrice(salePrice);
                    setEditing(true);
                  }}
                  className="text-[11px] text-zinc-500 underline underline-offset-2 transition hover:text-zinc-300"
                >
                  edit
                </button>
              )}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="text-sm text-zinc-400">Est. eBay fees</span>
          <span className="text-sm font-medium text-red-400">
            −${fees.toFixed(2)}
          </span>
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-white/5 pt-3">
          <span className="text-sm font-semibold text-white">You keep</span>
          <span className="text-lg font-bold text-emerald-400">
            ${net.toFixed(2)}
          </span>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-zinc-600">
          Estimated at a {(EBAY_FEE_RATE * 100).toFixed(2)}% final value fee +
          ${EBAY_FLAT_FEE.toFixed(2)} per order. Your actual fees depend on
          your eBay store tier and category.
        </p>
      </div>

      {onNext && (
        <button
          onClick={onNext}
          className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
        >
          Next card →
        </button>
      )}

      {onChange && (
        <button
          onClick={unsell}
          className="text-xs text-zinc-500 underline underline-offset-4 transition hover:text-zinc-300"
        >
          Not sold after all — {item.listedAt ? "back to listed" : "back to editing"}
        </button>
      )}
    </div>
  );
}
