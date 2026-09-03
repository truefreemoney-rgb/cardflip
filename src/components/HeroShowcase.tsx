import { buildListing, formatMoney, quotePrice, printingLabelOf } from "@/lib/listing";
import type { PokemonCard } from "@/lib/types";

/**
 * Renders the real output of the real pipeline for a genuine card, so the
 * marketing page can't drift from what the product actually produces.
 */
export default function HeroShowcase({ card }: { card: PokemonCard | null }) {
  if (!card) return null;

  const quote = quotePrice(card, "Near Mint", "quick");
  const price = quote?.suggested ?? 0;
  const listing = buildListing(card, price, "Near Mint", printingLabelOf(quote?.price));

  return (
    <div className="relative mx-auto grid w-full max-w-3xl items-center gap-8 sm:grid-cols-[minmax(0,200px)_1fr]">
      <div className="relative mx-auto w-44 sm:w-full">
        <div
          className="absolute -inset-6 rounded-full bg-[conic-gradient(from_140deg,rgba(125,211,252,0.25),rgba(167,139,250,0.3),rgba(240,171,252,0.25),rgba(125,211,252,0.25))] blur-3xl"
          aria-hidden
        />
        <div className="sheen relative rounded-xl transition duration-300 hover:-translate-y-1 hover:rotate-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.imageLarge || card.imageSmall}
            alt={`${card.name} — ${card.setName}`}
            className="w-full rounded-xl shadow-2xl shadow-black/60"
          />
        </div>
      </div>

      <div className="foil-edge rounded-2xl p-5 [--foil-fill:#0b0d13]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Generated listing
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Ready to post
          </span>
        </div>

        <p className="mt-3 text-sm font-medium leading-snug text-white">
          {listing.title}
        </p>

        <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/5 pt-4">
          <div>
            <p className="text-2xl font-semibold text-emerald-400">
              ${price.toFixed(2)}
            </p>
            <p className="text-xs text-zinc-500">
              {quote
                ? `Market ${formatMoney(quote.base, quote.price.currency)}`
                : "Set your price"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-400">{card.setName}</p>
            <p className="text-xs text-zinc-600">Card {card.number}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
