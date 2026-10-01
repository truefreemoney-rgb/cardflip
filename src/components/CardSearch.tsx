"use client";

import { useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import Spinner from "@/components/Spinner";
import SetBrowser from "@/components/SetBrowser";
import GameToggle from "@/components/GameToggle";
import { searchTyped } from "@/lib/cards";
import { GAMES, readSavedGame, saveGame } from "@/lib/games";
import { pickPrice, priceFlagOf } from "@/lib/listing";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

/**
 * The one card search (10-01, Chris: "any change to the search in Search
 * Cards should also affect the Watchlist search and vice versa"). Search
 * Cards and the Watchlist share the hook, the box (game, By Name / By Set,
 * the input, the set browser) and the results header (count, filter, sort,
 * Clear). Each page keeps only its own tile: Search opens the price modal,
 * the Watchlist adds the card.
 */

export type CardSearchMode = "search" | "browse";

type SortKey = "default" | "price-desc" | "price-asc" | "rarity" | "name" | "set";

/** Rarity rank, higher = rarer. MTG names are Scryfall's; the Pokémon
 *  mirror carries no rarity, so a numerator past the set total (secret /
 *  ultra tier) is the only signal there. */
function rarityRank(card: PokemonCard): number {
  const r = (card.rarity ?? "").toLowerCase();
  if (r) {
    if (r.includes("mythic")) return 5;
    if (r.includes("special") || r.includes("bonus")) return 4;
    if (r.includes("rare")) return 3;
    if (r.includes("uncommon")) return 2;
    if (r.includes("common")) return 1;
  }
  return card.isSecretRare ? 4 : 0;
}
// A card whose market the price guard flags sorts as unpriced (lib/priceFlag.ts).
const marketOf = (card: PokemonCard): number => (priceFlagOf(card) ? -1 : (pickPrice(card)?.market ?? -1));
function sortCards(cards: PokemonCard[], sort: SortKey): PokemonCard[] {
  if (sort === "default") return cards;
  const out = [...cards];
  switch (sort) {
    case "price-desc": out.sort((a, b) => marketOf(b) - marketOf(a)); break;
    case "price-asc": out.sort((a, b) => (marketOf(a) < 0 ? 1 : marketOf(b) < 0 ? -1 : marketOf(a) - marketOf(b))); break;
    case "name": out.sort((a, b) => a.name.localeCompare(b.name)); break;
    case "rarity": out.sort((a, b) => rarityRank(b) - rarityRank(a) || marketOf(b) - marketOf(a)); break;
    case "set": out.sort((a, b) => a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number, undefined, { numeric: true })); break;
  }
  return out;
}

/** `onReset` fires whenever the shown cards are replaced or dropped (close an open card). */
export function useCardSearch(language: ScanLanguage, onReset?: () => void) {
  // Same per-browser game choice as the scanner.
  const [game, setGameState] = useState<GameId>(readSavedGame);
  const [mode, setModeState] = useState<CardSearchMode>("search");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PokemonCard[]>([]);
  // What the grid is showing: "184 results for Charizard" / "All 182 cards in Destined Rivals".
  const [title, setTitle] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("default");
  const [filter, setFilter] = useState("");
  // Search sequence: a slow older response must not overwrite a newer one
  // (fire two searches fast and the first can land last).
  const seq = useRef(0);

  function apply(cards: PokemonCard[], nextTitle: string | null) {
    onReset?.();
    setFilter("");
    setResults(cards);
    setTitle(cards.length > 0 ? nextTitle : null);
  }
  /** Cards from somewhere other than the typed search (a set, a photo): any search still in flight is dropped. */
  function show(cards: PokemonCard[], nextTitle: string | null) {
    ++seq.current;
    setSearching(false);
    apply(cards, nextTitle);
  }

  function setGame(next: GameId) {
    setGameState(next);
    saveGame(next);
    show([], null);
  }

  function setMode(next: CardSearchMode) {
    setModeState(next);
    setError(null);
  }

  async function search() {
    const typed = query.trim();
    if (!typed) return;
    const mine = ++seq.current;
    setSearching(true);
    setError(null);
    onReset?.();
    try {
      // Sellers type what's printed on the card they're holding ("Charizard
      // 4/102"). Every printing, not the scanner's top 24; a typed number
      // shows only the card it names.
      const found = (await searchTyped(typed, game, language)) ?? [];
      if (mine !== seq.current) return;
      apply(found, `${found.length} result${found.length === 1 ? "" : "s"} for “${typed}”`);
      if (found.length === 0) setError("No cards matched that search.");
    } catch {
      if (mine !== seq.current) return;
      setError("Search failed — check your connection.");
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  }

  function clear() {
    show([], null);
    setError(null);
    setQuery("");
  }

  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      sortCards(
        needle
          ? results.filter((c) => `${c.name} ${c.englishName ?? ""} ${c.number} ${c.rarity ?? ""} ${c.setName}`.toLowerCase().includes(needle))
          : results,
        sort,
      ),
    [results, needle, sort],
  );

  return { game, setGame, mode, setMode, query, setQuery, searching, setSearching, error, setError, results, shown, title, sort, setSort, filter, setFilter, filtering: needle !== "", search, show, clear };
}

export type CardSearch = ReturnType<typeof useCardSearch>;

export function CardSearchBox({
  search,
  disabled = false,
  extra,
  rowProps,
  hint,
}: {
  search: CardSearch;
  /** The page is busy with something of its own (the Watchlist reading a photo). */
  disabled?: boolean;
  /** Buttons beside Search (the Watchlist's "From a photo"). */
  extra?: ReactNode;
  /** Handlers for the input row (the Watchlist's photo drop target). */
  rowProps?: HTMLAttributes<HTMLDivElement>;
  /** The line under the box. */
  hint?: ReactNode;
}) {
  const { game, mode } = search;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GameToggle game={game} onChange={search.setGame} compact />
        <div className="flex items-center gap-1 rounded-full border border-edge bg-black/30 p-1">
          {(["search", "browse"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => search.setMode(m)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                mode === m ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "search" ? "By Name" : "By Set"}
            </button>
          ))}
        </div>
      </div>

      {mode === "search" ? (
        <div {...rowProps} className={extra ? "flex flex-col gap-2 sm:flex-row" : "flex gap-2"}>
          <input
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !disabled && void search.search()}
            placeholder={`Name or number — ${GAMES[game].searchPlaceholder}`}
            className="min-w-0 flex-1 rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
          />
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => void search.search()}
              disabled={search.searching || disabled}
              className={`flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60 ${extra ? "flex-1 sm:flex-none" : ""}`}
            >
              {search.searching && <Spinner className="h-4 w-4" />}
              Search
            </button>
            {extra}
          </div>
        </div>
      ) : (
        <SetBrowser
          key={game}
          game={game}
          onBusy={search.setSearching}
          onError={search.setError}
          onResults={(cards, title) => search.show(cards, title)}
        />
      )}
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
      {search.error && <p className="text-xs text-red-400">{search.error}</p>}
    </>
  );
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: "price-desc", label: "Price: High to Low" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "rarity", label: "Rarity" },
  { value: "name", label: "Name A–Z" },
  { value: "set", label: "Set A–Z" },
];

export function CardSearchResults({
  search,
  hint,
  children,
}: {
  search: CardSearch;
  /** What a tap does: "tap a card for its prices". */
  hint: string;
  /** The page's own grid of tiles for the cards shown. */
  children: (cards: PokemonCard[]) => ReactNode;
}) {
  if (search.results.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          <span className="font-medium text-zinc-200">{search.title}</span>
          <span className="text-zinc-600"> · {search.filtering ? `showing ${search.shown.length}` : hint}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search.filter}
            onChange={(e) => search.setFilter(e.target.value)}
            placeholder="Filter these cards…"
            aria-label="Filter the cards shown"
            className="w-40 rounded-lg border border-edge bg-black/40 px-3 py-1.5 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
          />
          <div className="relative">
            <select
              value={search.sort}
              onChange={(e) => search.setSort(e.target.value as SortKey)}
              aria-label="Sort cards"
              className="appearance-none rounded-lg border border-edge bg-black/40 py-1.5 pl-3 pr-7 text-xs text-zinc-200 outline-none transition focus:border-brand-400"
            >
              <option value="default">{search.mode === "browse" ? "Set Order" : "Best Match"}</option>
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500">▾</span>
          </div>
          <button
            onClick={search.clear}
            className="shrink-0 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
          >
            ✕ Clear
          </button>
        </div>
      </div>
      {search.shown.length === 0 ? (
        <p className="rounded-xl border border-edge bg-surface-1 px-4 py-6 text-center text-sm text-zinc-500">
          Nothing matches that filter.
        </p>
      ) : (
        children(search.shown)
      )}
    </div>
  );
}
