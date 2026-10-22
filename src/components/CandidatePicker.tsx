"use client";

import { useState } from "react";
import CardImage from "@/components/CardImage";
import Sheet from "@/components/Sheet";
import Spinner from "@/components/Spinner";
import { searchTyped } from "@/lib/cards";
import { displayCardNumber } from "@/lib/games";
import type { PokemonCard, ScanItem } from "@/lib/types";

/** How many of the matcher's other candidates the picker shows before the name search. */
const SHOWN = 6;

/**
 * "Select Your Card" (10-15, Chris's TCGplayer screenshot, built our way):
 * a "Find matches" search on top, then a 2-column grid of BIG card pictures,
 * each with name, set and number under it, so a wrong printing is one tap
 * with the art doing the telling. Opens from "Not this card?" on the camera's
 * result card with the matcher's other candidates (item.candidates, best
 * first); the search reuses the editor's searchTyped for when the right card
 * was never a candidate.
 */
export default function CandidatePicker({
  item,
  onPick,
  onClose,
}: {
  item: ScanItem;
  onPick: (card: PokemonCard, candidates: PokemonCard[]) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<PokemonCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = item.card;
  const others = item.candidates.filter((c) => c.id !== current?.id).slice(0, SHOWN);
  const list = found ?? others;

  async function runSearch() {
    if (!term.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      const cards = (await searchTyped(term, item.game ?? "pokemon", item.language, { limit: 24, exact: false })) ?? [];
      if (cards.length === 0) setError("No cards matched that search.");
      setFound(cards.length > 0 ? cards : null);
    } catch {
      setError("Search failed — check your connection.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Sheet title="Select Your Card" backId="candidate-picker" onClose={onClose} z="z-[70]" bodyClassName="flex flex-col">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Find matches"
          aria-label="Find matches by card name"
          enterKeyHint="search"
          className="min-w-0 flex-1 rounded-full border border-edge bg-surface-2 px-4 py-2.5 text-base text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={searching}
          className="flex shrink-0 items-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
        >
          {searching && <Spinner className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {list.length === 0 && !error && <p className="mt-3 text-sm text-zinc-400">No other matches. Type the card&apos;s name above.</p>}
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Matching cards">
        {list.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c, found ?? item.candidates)}
              className="flex w-full flex-col overflow-hidden rounded-xl border border-edge bg-surface-2 text-left transition hover:border-edge-strong active:scale-[0.98]"
            >
              <span className="block aspect-[63/88] w-full overflow-hidden bg-black/40">
                {c.imageSmall && <CardImage src={c.imageSmall} alt="" className="h-full w-full object-cover" />}
              </span>
              <span className="block min-w-0 px-2 py-2">
                <span className="line-clamp-2 text-sm font-semibold leading-tight text-white">{c.name}</span>
                <span className="mt-1 line-clamp-2 text-xs leading-tight text-zinc-400">{c.setName}</span>
                <span className="block text-xs text-zinc-500">{displayCardNumber(c)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
