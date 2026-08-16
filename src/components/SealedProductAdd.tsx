"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import CardImage from "@/components/CardImage";
import { apiPath } from "@/lib/client/basePath";
import { sealedProductTypesFor, type SetInfo } from "@/lib/grading";
import type { GameId } from "@/lib/types";

interface Props {
  /** Which game's sets + product types; Pokémon when omitted. */
  game?: GameId;
  /** Called once per added product; the parent owns queue insertion. */
  onAdd: (set: SetInfo, productType: string) => void;
}

/**
 * Type-to-add for sealed product: pick the set, pick what it is (pack, box,
 * ETB…), and it enters the queue priced by hand. There is nothing to scan —
 * a booster box has no collector number — so unlike cards this flow is the
 * only way in, not a fallback for a failed photo.
 */
export default function SealedProductAdd({ game = "pokemon", onAdd }: Props) {
  const productTypes = sealedProductTypesFor(game);
  const [sets, setSets] = useState<SetInfo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SetInfo | null>(null);
  const [productType, setProductType] = useState<string>(productTypes[1] ?? productTypes[0]);
  const [added, setAdded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // (The parent keys this component by game, so switching game remounts it
  // with the new catalogue + default product.)

  // Fetched on first focus, not on mount: most scanner sessions never open
  // this panel, and the set list is a few hundred rows they'd pay for anyway.
  async function ensureSets() {
    if (sets || loading) return;
    setLoading(true);
    try {
      const res = await fetch(apiPath(`/api/sets${game === "pokemon" ? "" : `?game=${game}`}`));
      const data = await res.json();
      setSets(data.sets ?? []);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const matches =
    !sets || selected
      ? []
      : needle
        ? sets.filter((s) => s.name.toLowerCase().includes(needle)).slice(0, 8)
        : sets.slice(0, 8);

  function pickSet(set: SetInfo) {
    setSelected(set);
    setQuery(set.name);
    setAdded(null);
  }

  function clearSet() {
    setSelected(null);
    setAdded(null);
  }

  function handleAdd() {
    if (!selected) return;
    onAdd(selected, productType);
    setAdded(`${selected.name} ${productType}`);
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            clearSet();
          }}
          onFocus={() => void ensureSets()}
          placeholder={game === "mtg" ? "Set name — e.g. Modern Horizons 3" : "Set name — e.g. Evolving Skies"}
          className="flex-1 rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
        />
        <select
          value={productType}
          onChange={(e) => {
            setProductType(e.target.value);
            setAdded(null);
          }}
          className="rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-400"
        >
          {productTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          onClick={handleAdd}
          disabled={!selected}
          className="rounded-lg border border-edge bg-surface-2 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {loadFailed && (
        <p className="text-xs text-red-400">
          Couldn&apos;t load the set list — check your connection.
        </p>
      )}
      {added && (
        <p className="text-xs text-emerald-400">✓ {added} added to the queue</p>
      )}

      {matches.length > 0 && (
        <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
          {matches.map((set) => (
            <button
              key={set.name}
              onClick={() => pickSet(set)}
              className="flex items-center gap-2 rounded-lg border border-edge bg-black/20 p-2 text-left transition hover:border-edge-strong"
            >
              <CardImage
                src={set.logoUrl}
                alt=""
                className="h-8 w-12 shrink-0 rounded object-contain"
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-white">
                  {set.name}
                </span>
                <span className="block text-[10px] text-zinc-600">
                  {set.releaseDate.slice(0, 4)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {sets === null && loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Spinner className="h-3 w-3" /> Loading sets…
        </div>
      )}
    </div>
  );
}
