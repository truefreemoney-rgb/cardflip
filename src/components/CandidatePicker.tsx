"use client";

import { useEffect, useRef, useState } from "react";
import CardImage from "@/components/CardImage";
import Spinner from "@/components/Spinner";
import { searchTyped } from "@/lib/cards";
import { useFocusTrap } from "@/lib/client/useFocusTrap";
import { displayCardNumber } from "@/lib/games";
import type { PokemonCard, ScanItem } from "@/lib/types";

/** How many of the matcher's other candidates the picker shows before the name search. */
const SHOWN = 6;

/**
 * "Not this card?" on the camera's result chip. The other candidates the
 * matcher already had (item.candidates, best first), each with its art, so a
 * wrong printing is one tap, no new scan. "Search by name" reuses the
 * editor's search (searchTyped) for when the right card was never a candidate.
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
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<PokemonCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

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
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/90 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick the right card"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="panel-solid animate-fade-up flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-lg font-semibold text-white">Which card is it?</p>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white">
            ×
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search by name"
            aria-label="Search by card name"
            enterKeyHint="search"
            className="min-w-0 flex-1 rounded-full border border-edge bg-surface-2 px-4 py-2.5 text-base text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={searching}
            className="flex shrink-0 items-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
          >
            {searching && <Spinner className="h-3.5 w-3.5" />}
            Search
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {list.length === 0 && !error && <p className="mt-3 text-sm text-zinc-400">No other matches. Search by name above.</p>}
        <ul className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c, found ?? item.candidates)}
                className="flex w-full items-center gap-3 rounded-xl border border-edge bg-surface-2 p-2 text-left transition hover:border-edge-strong"
              >
                <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black/40">
                  {c.imageSmall && <CardImage src={c.imageSmall} alt="" className="h-full w-full" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{c.name}</span>
                  <span className="block truncate text-xs text-zinc-400">
                    {c.setName} · {displayCardNumber(c)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
