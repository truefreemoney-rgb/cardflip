"use client";

import Sheet from "@/components/Sheet";
import { CONDITIONS, canBeFirstEdition, canPriceListing, effectiveVariant, formatMoney, formatVariantLabel, isFirstEditionVariant, marketForCondition, pickPrice } from "@/lib/listing";
import { saveCondition } from "@/lib/client/scanPrefs";
import type { Condition, ScanItem } from "@/lib/types";

/**
 * "This copy" (10-15, after TCGplayer's Edit sheet, done our way): the quick
 * sheet behind the result card's "● Near Mint · Holofoil ✎" pill. Every tap
 * applies at once (the card behind it updates; Done just closes), each
 * condition chip says what the market price becomes, Printing shows only
 * when the card has more than one, and there is no Language row (ours is
 * picked before the scan; the match is already made). One tap sets the same
 * condition on every waiting scan when there are several.
 */
interface Props {
  item: ScanItem;
  onChange: (patch: Partial<ScanItem>) => void;
  /** Set this condition on every waiting scan; absent when there is only one. */
  onApplyConditionToAll?: (condition: Condition) => void;
  /** How many scans that would touch (the button names the number). */
  waiting?: number;
  onClose: () => void;
}

/** The chip dot and ring per condition: the same ladder as the result card. */
const TONE: Record<Condition, { dot: string; on: string }> = {
  "Near Mint": { dot: "bg-emerald-400", on: "border-emerald-400 bg-emerald-400/15 text-white" },
  "Lightly Played": { dot: "bg-sky-400", on: "border-sky-400 bg-sky-400/15 text-white" },
  "Moderately Played": { dot: "bg-amber-400", on: "border-amber-400 bg-amber-400/15 text-white" },
  "Heavily Played": { dot: "bg-orange-400", on: "border-orange-400 bg-orange-400/15 text-white" },
  Damaged: { dot: "bg-red-400", on: "border-red-400 bg-red-400/15 text-white" },
};

const OFF = "border-edge bg-surface-2 text-zinc-300 hover:border-edge-strong";

export default function CopyEditSheet({ item, onChange, onApplyConditionToAll, waiting = 0, onClose }: Props) {
  const card = item.card!;
  const firstEdEligible = canBeFirstEdition(card);
  // The printings on offer: real printings with a dollar market, one per
  // variant (the same rows as the card editor's Printing dropdown).
  const printings = card.prices.filter(
    (p, i, all) =>
      p.market != null &&
      p.market > 0 &&
      canPriceListing(p) &&
      p.source !== "ebay" &&
      p.variant !== "average" &&
      !(firstEdEligible && isFirstEditionVariant(p.variant)) &&
      all.findIndex((q) => q.variant === p.variant) === i,
  );
  const variant = effectiveVariant(item) ?? pickPrice(card)?.variant;
  // The Near Mint market this copy's printing is priced from; each
  // condition chip shows it through the condition multiplier.
  const base = printings.find((p) => p.variant === variant)?.market ?? pickPrice(card)?.market ?? null;

  return (
    <Sheet
      onClose={onClose}
      title="This copy"
      hint={card.name}
      backId="copy-edit"
      footer={
        <button type="button" onClick={onClose} className="w-full rounded-full bg-brand-500 py-3 text-sm font-semibold text-white transition hover:bg-brand-400">
          Done
        </button>
      }
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Condition</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {CONDITIONS.map((condition) => {
          const on = item.condition === condition;
          return (
            <button
              key={condition}
              type="button"
              aria-pressed={on}
              aria-label={base != null ? `${condition}, market ${formatMoney(marketForCondition(base, condition))}` : condition}
              onClick={() => {
                if (on) return;
                onChange({ condition, priceOverride: null });
                saveCondition(condition);
              }}
              className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm font-medium transition ${on ? TONE[condition].on : OFF}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[condition].dot}`} aria-hidden />
              <span>{condition}</span>
              {base != null && <span className="tabular-nums text-zinc-400">{formatMoney(marketForCondition(base, condition))}</span>}
            </button>
          );
        })}
      </div>
      {onApplyConditionToAll && waiting > 1 && (
        <button
          type="button"
          onClick={() => onApplyConditionToAll(item.condition)}
          className="mt-3 text-sm font-medium text-brand-300 underline-offset-4 hover:underline"
        >
          Use {item.condition} for all {waiting} waiting scans
        </button>
      )}

      {printings.length > 1 && (
        <>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Printing</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {printings.map((p) => {
              const on = p.variant === variant;
              return (
                <button
                  key={`${p.source}-${p.variant}`}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${formatVariantLabel(p.variant)}${p.market != null ? `, market ${formatMoney(marketForCondition(p.market, item.condition))}` : ""}`}
                  onClick={() => {
                    if (on) return;
                    onChange({ variant: p.variant, priceOverride: null });
                  }}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm font-medium transition ${on ? "border-brand-400 bg-brand-500/15 text-white" : OFF}`}
                >
                  <span>{formatVariantLabel(p.variant)}</span>
                  {p.market != null && <span className="tabular-nums text-zinc-400">{formatMoney(marketForCondition(p.market, item.condition))}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-4 text-xs text-zinc-500">Changes apply as you tap. Anything else is in the card itself.</p>
    </Sheet>
  );
}
