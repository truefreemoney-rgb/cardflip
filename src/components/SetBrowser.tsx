"use client";

import { useEffect, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import { fetchSetCards, fetchSets } from "@/lib/cards";
import type { SetInfo } from "@/lib/grading";
import type { GameId, PokemonCard } from "@/lib/types";

/**
 * Browse by set: a picker over the game's set list that loads every card
 * in the chosen set. Lifted out of Search cards so Watchlist can add from
 * a whole set too (Chris, 09-04: "push the set view into watchlist").
 * Mount it with `key={game}` — one instance per game: it loads that game's
 * set list once and owns the set-cards fetch; the page just receives the
 * cards and a title for them.
 */

interface Props {
  game: GameId;
  onResults: (cards: PokemonCard[], title: string | null) => void;
  onError: (message: string | null) => void;
  /** Busy flag for the page's own spinner, if it wants one. */
  onBusy?: (busy: boolean) => void;
}

function setLabel(set: SetInfo): string {
  const year = set.releaseDate ? set.releaseDate.slice(0, 4) : "";
  return year ? `${set.name} · ${year}` : set.name;
}

export default function SetBrowser({ game, onResults, onError, onBusy }: Props) {
  const [list, setList] = useState<SetInfo[] | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  // A slow older response must not overwrite a newer pick.
  const seq = useRef(0);
  // Page callbacks, read at call time so the fetch effect doesn't depend on them.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let cancelled = false;
    // Off the effect body (react-hooks rule); the list loads once per mount.
    const t = window.setTimeout(() => {
      fetchSets(game)
        .then((sets) => {
          if (!cancelled) setList(sets);
        })
        .catch(() => {
          if (!cancelled) {
            setList([]);
            onErrorRef.current("Couldn't load the set list — check your connection.");
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [game]);

  async function browse(next: string) {
    setKey(next);
    onError(null);
    if (!next) {
      onResults([], null);
      return;
    }
    const set = (list ?? []).find((s) => (s.code ?? s.name) === next);
    const mine = ++seq.current;
    setBusy(true);
    onBusy?.(true);
    try {
      const cards = await fetchSetCards(next, game);
      if (mine !== seq.current) return;
      onResults(cards, cards.length > 0 ? `All ${cards.length} cards in ${set?.name ?? next}` : null);
      if (cards.length === 0) onError("That set has no cards in the catalogue yet.");
    } catch {
      if (mine !== seq.current) return;
      onError("Couldn't load that set — check your connection.");
    } finally {
      if (mine === seq.current) {
        setBusy(false);
        onBusy?.(false);
      }
    }
  }

  const loading = list === null;
  const sets = list ?? [];
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor={`set-picker-${game}`}>
        Set
      </label>
      <div className="relative">
        <select
          id={`set-picker-${game}`}
          value={key}
          disabled={loading || sets.length === 0}
          onChange={(e) => void browse(e.target.value)}
          className="w-full appearance-none rounded-lg border border-edge bg-black/40 py-2.5 pl-3 pr-10 text-sm text-white outline-none transition focus:border-brand-400 disabled:opacity-60"
        >
          <option value="">{loading ? "Loading sets…" : `Choose a set (${sets.length})`}</option>
          {sets.map((set) => (
            <option key={set.code ?? set.name} value={set.code ?? set.name}>
              {setLabel(set)}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
          {busy ? <Spinner className="h-4 w-4" /> : "▾"}
        </span>
      </div>
    </div>
  );
}
