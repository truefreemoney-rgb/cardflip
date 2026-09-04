"use client";

import CardImage from "@/components/CardImage";
import PriceSparkline from "@/components/PriceSparkline";
import Spinner from "@/components/Spinner";

/**
 * The Watchlist's card tile, shared (Chris, 09-04: "I love the card view,
 * push that into Search cards"): big art, name, set · number, the price in
 * display type, a sparkline when the card has history. Slots for a badge on
 * the art, a corner action, and a footer row so each page can add its own
 * controls without forking the look.
 */

interface Props {
  imageUrl: string;
  name: string;
  englishName?: string | null;
  subtitle: string;
  price: number | null;
  priceNote?: string;
  /** Rendered beside the price (a delta, a rarity chip…). */
  aside?: React.ReactNode;
  /** Catalog id for the price history sparkline; omit = no chart. */
  sparkCardId?: string | null;
  /** Pill over the art (top-left). */
  badge?: React.ReactNode;
  /** Small control over the art (top-right), e.g. remove. */
  corner?: React.ReactNode;
  footer?: React.ReactNode;
  selected?: boolean;
  opening?: boolean;
  onOpen: () => void;
}

export default function CardTile({
  imageUrl,
  name,
  englishName,
  subtitle,
  price,
  priceNote,
  aside,
  sparkCardId,
  badge,
  corner,
  footer,
  selected = false,
  opening = false,
  onOpen,
}: Props) {
  return (
    <div
      className={`group relative flex flex-col gap-2.5 rounded-xl border p-3 transition ${
        selected ? "border-brand-400 bg-brand-500/10" : "border-edge bg-surface-1 hover:border-edge-strong"
      }`}
    >
      {corner}
      <button
        onClick={onOpen}
        title={`Open ${name}`}
        className="relative w-full rounded-lg transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
      >
        <CardImage src={imageUrl} alt={name} className="aspect-[5/7] w-full rounded-lg" />
        {badge && <span className="absolute left-2 top-2">{badge}</span>}
        {opening && (
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
            <Spinner className="h-5 w-5" />
          </span>
        )}
      </button>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{name}</p>
        {englishName && <p className="truncate text-xs font-medium text-brand-300">{englishName}</p>}
        <p className="truncate text-xs text-zinc-500">{subtitle}</p>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-display text-lg font-semibold leading-tight ${price != null ? "text-emerald-400" : "text-zinc-600"}`}>
            {price != null ? `$${price.toFixed(2)}` : "—"}
          </p>
          {priceNote && <p className="text-[11px] text-zinc-600">{priceNote}</p>}
        </div>
        {aside}
      </div>

      {sparkCardId && <PriceSparkline cardId={sparkCardId} />}
      {footer}
    </div>
  );
}
