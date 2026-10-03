import type { PokemonCard } from "@/lib/types";
import { formatMoney } from "@/lib/listing";

/**
 * Homepage demo strip: one real card at each stage a card goes through —
 * scanned, priced, listed, sold — drawn as Inventory rows (thumbnail, name,
 * status pill, price) so a visitor sees the product, not another card wall
 * (Chris 10-02: the framed picture grid under the wall "really don't like the
 * design and empty space"). Static markup, no client code; every row says
 * EXAMPLE so nobody reads it as data. Cards the wall already shows are skipped
 * when there are enough others.
 */
const STAGES = [
  { label: "Scanned", cls: "bg-zinc-500/15 text-zinc-300" },
  { label: "Priced", cls: "bg-brand-500/15 text-brand-300" },
  { label: "Listed on eBay", cls: "bg-sky-500/15 text-sky-300" },
  { label: "Sold", cls: "bg-emerald-500/15 text-emerald-300" },
] as const;

/** One card per stage, no repeated names; the first `skip` cards (the wall's) are left out when the rest suffice. */
function pickRows(cards: PokemonCard[], priceOf: (c: PokemonCard) => number | null, skip: number): PokemonCard[] {
  const pick = (pool: PokemonCard[]) => {
    const rows: PokemonCard[] = [];
    for (const c of pool) {
      if (rows.length === STAGES.length) break;
      if (rows.length > 0 && priceOf(c) === null) continue;
      if (!rows.some((r) => r.name === c.name)) rows.push(c);
    }
    return rows;
  };
  const rest = pick(cards.slice(skip));
  return rest.length === STAGES.length ? rest : pick(cards);
}

export default function DemoInventory({ cards, priceOf, skip = 0 }: { cards: PokemonCard[]; priceOf: (c: PokemonCard) => number | null; skip?: number }) {
  const rows = pickRows(cards, priceOf, skip);
  if (rows.length < STAGES.length) return null;
  return (
    <figure>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((c, i) => {
          const stage = STAGES[i];
          const price = priceOf(c);
          return (
            <li key={c.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-edge bg-black/30 p-2.5">
              <div className="relative h-16 w-[46px] shrink-0 overflow-hidden rounded-md bg-black/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageSmall || c.imageLarge} alt="" aria-hidden width={245} height={342} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{c.name}</p>
                <p className="truncate text-xs text-zinc-500">{c.setName}</p>
                <span className={`mt-1 inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${stage.cls}`}>{stage.label}</span>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Example</p>
                <p className="mt-0.5 font-display text-sm font-semibold tabular-nums text-white">{i === 0 ? <span className="text-zinc-500">pricing…</span> : price !== null ? formatMoney(price) : ""}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <figcaption className="mt-3 text-xs text-zinc-500">Scan a card and it takes these four steps on its own. Nothing to type, nothing to look up.</figcaption>
    </figure>
  );
}
