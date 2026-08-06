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

export default function SoldPanel({ item }: { item: ScanItem }) {
  const card = item.card!;
  const salePrice = item.soldPrice ?? 0;
  const fees = salePrice * EBAY_FEE_RATE + EBAY_FLAT_FEE;
  const net = Math.max(0, salePrice - fees);

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
          <span className="text-sm font-medium text-white">
            ${salePrice.toFixed(2)}
          </span>
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
    </div>
  );
}
