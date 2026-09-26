import type { PokemonCard } from "@/lib/types";

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
  for (const c of cards) {
    if (c.game && c.game !== "pokemon") continue;
    if (rows.length === STAGES.length) break;
    if (!rows.some((r) => r.name === c.name)) rows.push(c);
  }
  if (rows.length < STAGES.length) return null;
  return (
    <figure className="mt-4 overflow-hidden rounded-2xl border border-edge bg-black/30">
      <ul className="divide-y divide-edge">
        {rows.map((c, i) => {
          const stage = STAGES[i];
          const price = priceOf(c);
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageSmall} alt="" aria-hidden className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute inset-x-0 bottom-0 bg-black/70 text-center whitespace-nowrap text-[7px] font-semibold uppercase leading-3 text-zinc-200">
                  Example
                </span>
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="truncate text-sm font-medium text-white">{c.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-zinc-500">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${stage.cls}`}>{stage.label}</span>
                  <span className="truncate">{stage.hint}</span>
                </div>
              </div>
              {i > 0 && price !== null && (
                <span className="shrink-0 font-display text-sm font-semibold text-white">${price.toFixed(2)}</span>
              )}
              {i === 0 && <span className="shrink-0 text-xs text-zinc-600">pricing…</span>}
            </li>
          );
        })}
      </ul>
      <figcaption className="border-t border-edge px-3 py-2 text-xs text-zinc-500">
        Every card moves down this list on its own. You only press the shutter.
      </figcaption>
    </figure>
  );
}
