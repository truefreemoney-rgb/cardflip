import type { PokemonCard } from "@/lib/types";
import { formatMoney } from "@/lib/listing";

/**
 * Homepage demo frame (mockup approved 09-08): the Inventory with one real
 * card at each stage a card goes through — scanned, priced, listed, sold —
 * so a visitor sees what CardFlip does before signing up. Static markup, no
 * client code; every art has an EXAMPLE ribbon so nobody reads it as data.
 */
const STAGES = [
  { label: "Scanned", cls: "bg-zinc-500/15 text-zinc-300", hint: "just now" },
  { label: "Priced", cls: "bg-brand-500/15 text-brand-300", hint: "market price" },
  { label: "Listed on eBay", cls: "bg-sky-500/15 text-sky-300", hint: "live" },
  { label: "Sold", cls: "bg-emerald-500/15 text-emerald-300", hint: "paid out" },
] as const;

export default function DemoInventory({ cards, priceOf }: { cards: PokemonCard[]; priceOf: (c: PokemonCard) => number | null }) {
  // One card per stage, no repeated names (the wall is allowed twins; the list is not).
  const rows: PokemonCard[] = [];
  // Pokémon only (Chris 09-26): the frame is the Pokémon story.
  // Priced / Listed / Sold need a real price; Scanned is "pricing…" anyway.
  const pool = cards.filter((c) => !c.game || c.game === "pokemon");
  for (const c of pool) {
    if (rows.length === STAGES.length) break;
    if (rows.length > 0 && priceOf(c) === null) continue;
    if (!rows.some((r) => r.name === c.name)) rows.push(c);
  }
  if (rows.length < STAGES.length) return null;
  return (
    <figure className="mt-4 overflow-hidden rounded-2xl border border-edge bg-black/30 p-3">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((c, i) => {
          const stage = STAGES[i];
          const price = priceOf(c);
          return (
            <li key={c.id} className="min-w-0">
              <div className="relative aspect-[5/7] w-full overflow-hidden rounded-xl bg-black/50 shadow-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageLarge || c.imageSmall} alt="" aria-hidden className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute left-2 top-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-200 backdrop-blur">
                  Example
                </span>
              </div>
              <div className="mt-2 truncate text-sm font-medium text-white">{c.name}</div>
              <div className="mt-1">
                <span className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 align-top text-[11px] font-semibold ${stage.cls}`}>{stage.label}</span>
              </div>
              <div className="mt-1 whitespace-nowrap text-xs text-zinc-500">
                {i === 0 ? (
                  "pricing…"
                ) : price !== null ? (
                  <span className="font-display text-sm font-semibold text-white">{formatMoney(price)}</span>
                ) : (
                  stage.hint
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <figcaption className="mt-3 text-xs text-zinc-500">
        Every card moves through these four steps on its own. You only press the shutter.
      </figcaption>
    </figure>
  );
}
