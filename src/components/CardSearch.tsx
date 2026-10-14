"use client";

import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import Spinner from "@/components/Spinner";
import SetBrowser from "@/components/SetBrowser";
import MissingCardReport from "@/components/MissingCardReport";
import { useOptionalSession } from "@/components/SessionProvider";
import { useBodyScrollLock } from "@/lib/client/useBodyScrollLock";
import { SheetHandle, useDragToClose } from "@/components/Sheet";
import { fetchSetCards, searchTyped } from "@/lib/cards";
import { GAMES, GAME_IDS, readSavedGame, saveGame } from "@/lib/games";
import { pickPrice, priceFlagOf } from "@/lib/listing";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

const NO_MATCH = "No cards matched that search.";
/** Cards per page of results; "Show more" adds another page (10-14 redesign: 200 tiles at once was a wall). */
const PAGE = 24;
const VIEW_KEY = "cardflip.searchView";
export type CardSearchView = "list" | "grid";

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
  const [rarity, setRarity] = useState<string | null>(null);
  // How many of the shown cards are on screen (PAGE at a time).
  const [limit, setLimit] = useState(PAGE);
  // The query the shown results answer: the box offers Search while the typed text differs, ✕ once it matches.
  const [searched, setSearched] = useState("");
  // The set a set tile opened, so the picker the box turns into shows it.
  const [browsed, setBrowsed] = useState("");
  // List or grid (10-14: list rows on a phone), remembered per browser.
  const [view, setViewState] = useState<CardSearchView>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  function setView(next: CardSearchView) {
    setViewState(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private mode: the choice just doesn't stick.
    }
  }
  // Search sequence: a slow older response must not overwrite a newer one
  // (fire two searches fast and the first can land last).
  const seq = useRef(0);

  function apply(cards: PokemonCard[], nextTitle: string | null) {
    onReset?.();
    setFilter("");
    setRarity(null);
    setLimit(PAGE);
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
      setSearched(typed);
      apply(found, `${found.length.toLocaleString("en-US")} ${found.length === 1 ? "card" : "cards"}`);
      if (found.length === 0) setError(NO_MATCH);
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
    setSearched("");
  }

  /** Every card of one set (the Search page's set tiles): the box switches to the set picker's mode. */
  async function browseSet(code: string, name: string) {
    const mine = ++seq.current;
    setBrowsed(code);
    setModeState("browse");
    setSearching(true);
    setError(null);
    try {
      const cards = await fetchSetCards(code, game);
      if (mine !== seq.current) return;
      apply(cards, cards.length > 0 ? `All ${cards.length} cards in ${name}` : null);
      if (cards.length === 0) setError("That set has no cards in the catalogue yet.");
    } catch {
      if (mine !== seq.current) return;
      setError("Couldn't load that set — check your connection.");
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      sortCards(
        results.filter(
          (c) =>
            (!rarity || (c.rarity ?? "") === rarity) &&
            (!needle || `${c.name} ${c.englishName ?? ""} ${c.number} ${c.rarity ?? ""} ${c.setName}`.toLowerCase().includes(needle)),
        ),
        sort,
      ),
    [results, needle, rarity, sort],
  );
  // The rarities the results hold, for the sheet's chips (none when the catalogue carries none).
  const rarities = useMemo(() => [...new Set(results.map((c) => c.rarity ?? "").filter(Boolean))].sort(), [results]);

  return {
    game, setGame, mode, setMode, query, setQuery, searching, setSearching, error, setError, results, shown, title, sort, setSort,
    filter, setFilter, filtering: needle !== "" || rarity !== null, rarity, setRarity, rarities, limit, setLimit, searched, browsed, view, setView,
    search, show, clear, browseSet,
  };
}

export type CardSearch = ReturnType<typeof useCardSearch>;

/** The games this account may search (every game after Pokémon is admins-only until its switch is flipped, as GameToggle). */
function useVisibleGames(): GameId[] {
  const features = useOptionalSession()?.user?.features;
  return GAME_IDS.filter((id) => id === "pokemon" || (features ? features[id as keyof typeof features] ?? true : true));
}

/** The game, as one pill beside the box (10-14 redesign); the phone's own picker opens on a tap. */
function GamePicker({ game, onChange }: { game: GameId; onChange: (game: GameId) => void }) {
  const visible = useVisibleGames();
  const hidden = !visible.includes(game);
  useEffect(() => {
    if (hidden) onChange("pokemon");
  }, [hidden, onChange]);
  if (visible.length < 2) return null;
  return (
    <label className="relative flex h-12 shrink-0 items-center rounded-2xl border border-edge bg-surface-2 pl-3.5 pr-8 text-sm font-semibold text-white transition hover:border-edge-strong focus-within:border-brand-400">
      {GAMES[game].label}
      <select
        value={game}
        onChange={(e) => onChange(e.target.value as GameId)}
        aria-label="Card game"
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        {visible.map((id) => (
          <option key={id} value={id}>
            {GAMES[id].label}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 20 20" className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M5.5 8l4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

const SearchIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
    <circle cx="9" cy="9" r="5.5" />
    <path d="M13.2 13.2L17 17" strokeLinecap="round" />
  </svg>
);

/**
 * The box (10-14 redesign, Chris: "it needs to look really good"): the game pill and one big field, pinned under
 * the header while the results scroll. Name search is the default; "Whole set" (in Sort & filter, or a set tile)
 * swaps the field for the set picker.
 */
export function CardSearchBox({
  search,
  disabled = false,
  extra,
  rowProps,
  hint,
  sticky = false,
}: {
  search: CardSearch;
  /** The page is busy with something of its own (the Watchlist reading a photo). */
  disabled?: boolean;
  /** Buttons under the box (the Watchlist's "From a photo"). */
  extra?: ReactNode;
  /** Handlers for the input row (the Watchlist's photo drop target). */
  rowProps?: HTMLAttributes<HTMLDivElement>;
  /** The line under the box. */
  hint?: ReactNode;
  /** Pin the box under the app header (Search, where it is the page's top row). */
  sticky?: boolean;
}) {
  const { game, mode } = search;
  const typed = search.query.trim();
  // Typed text the results don't answer yet: offer Search; once they do, ✕ clears.
  const dirty = typed !== "" && typed !== search.searched;
  return (
    <>
      <div className={sticky ? "sticky top-12 z-30 -mx-4 bg-background/90 px-4 pb-3 pt-2 backdrop-blur-md sm:top-[4.25rem] sm:-mx-6 sm:px-6" : ""}>
        <div {...rowProps} className="flex gap-2">
          <GamePicker game={game} onChange={search.setGame} />
          {mode === "search" ? (
            <div className="flex h-12 min-w-0 flex-1 items-center rounded-2xl border border-edge-strong bg-black/40 transition focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/15">
              <SearchIcon className="ml-3.5 h-[18px] w-[18px] shrink-0 text-zinc-500" />
              <input
                type="search"
                enterKeyHint="search"
                value={search.query}
                onChange={(e) => search.setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !disabled && void search.search()}
                placeholder="Name or number"
                aria-label={`Search ${GAMES[game].label} cards by name or number`}
                // The field's border carries focus (focus-within); the global :focus-visible ring would draw a second box inside it.
                style={{ outline: "none" }}
                className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-base text-white outline-none placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden"
              />
              {search.searching ? (
                <Spinner className="mr-3.5 h-4 w-4 shrink-0" />
              ) : dirty ? (
                <button
                  type="button"
                  onClick={() => void search.search()}
                  disabled={disabled}
                  className="mr-1.5 h-9 shrink-0 rounded-xl bg-brand-500 px-3.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
                >
                  Search
                </button>
              ) : typed ? (
                <button
                  type="button"
                  onClick={search.clear}
                  aria-label="Clear the search"
                  className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-300 transition hover:bg-white/20 hover:text-white"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" strokeLinecap="round" />
                  </svg>
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 gap-2">
              <div className="min-w-0 flex-1">
                <SetBrowser
                  key={`${game}:${search.browsed}`}
                  game={game}
                  compact
                  initial={search.browsed}
                  onBusy={search.setSearching}
                  onError={search.setError}
                  onResults={(cards, title) => search.show(cards, title)}
                />
              </div>
              <button
                type="button"
                onClick={() => search.setMode("search")}
                aria-label="Search by name instead"
                title="Search by name instead"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-edge bg-surface-2 text-zinc-300 transition hover:border-edge-strong hover:text-white"
              >
                <SearchIcon className="h-[18px] w-[18px]" />
              </button>
            </div>
          )}
        </div>
        {extra && <div className="mt-2 flex gap-2">{extra}</div>}
      </div>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      {search.error && <p className="text-sm text-red-400">{search.error}</p>}
      {/* Catalog miss by name (Chris 10-08): same report as the scanner pick list, lands in /admin/support as "Missing Card:". */}
      {search.error === NO_MATCH && mode === "search" && search.query.trim() !== "" && <MissingCardReport game={game} typed={search.query} />}
    </>
  );
}

function sortOptions(mode: CardSearchMode): { value: SortKey; label: string }[] {
  return [
    { value: "default", label: mode === "browse" ? "Set order" : "Best match" },
    { value: "price-desc", label: "Most valuable" },
    { value: "price-asc", label: "Cheapest first" },
    { value: "rarity", label: "Rarest first" },
    { value: "name", label: "Name A–Z" },
    { value: "set", label: "Set A–Z" },
  ];
}

const SheetLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{children}</p>
);

/** Sort & filter, one sheet (10-14 redesign): how to look up, the order, rarity, and a narrowing filter. Replaced the "✕ Clear" chip row. */
function SortSheet({ search, onClose }: { search: CardSearch; onClose: () => void }) {
  useBodyScrollLock();
  // Chris 10-14 (phone): "the handle slide down doesn't close, just gets stuck" — the bar was drawn, not wired.
  const panelRef = useRef<HTMLDivElement>(null);
  const handle = useDragToClose(panelRef, onClose);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const n = search.shown.length;
  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
      active ? "border-brand-400/70 bg-brand-500/20 text-white" : "border-edge bg-surface-1 text-zinc-300 hover:border-edge-strong"
    }`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sort and filter"
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up panel-solid flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-edge-strong shadow-2xl shadow-black/60 sm:max-w-md sm:rounded-3xl sm:border"
      >
        {/* Pinned above the scrolling body so it never scrolls out of reach. */}
        <SheetHandle {...handle} />
        <div className="overflow-y-auto overscroll-contain px-5 pb-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-white">Sort &amp; filter</h2>
            <button
              type="button"
              onClick={() => {
                search.setSort("default");
                search.setRarity(null);
                search.setFilter("");
              }}
              className="rounded-lg px-2 py-1 text-sm font-medium text-brand-300 transition hover:text-brand-200"
            >
              Reset
            </button>
          </div>

          <SheetLabel>Look up by</SheetLabel>
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-edge bg-surface-1 p-1">
            {(["search", "browse"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={search.mode === m}
                onClick={() => {
                  search.setMode(m);
                  // Whole set: the box above becomes the set picker, so show it.
                  if (m === "browse" && search.mode !== "browse") onClose();
                }}
                className={`rounded-xl py-2.5 text-sm font-semibold transition ${search.mode === m ? "bg-surface-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {m === "search" ? "Card name" : "Whole set"}
              </button>
            ))}
          </div>

          <SheetLabel>Sort by</SheetLabel>
          <div role="radiogroup" aria-label="Sort by" className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-edge bg-surface-1">
            {sortOptions(search.mode).map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={search.sort === o.value}
                onClick={() => search.setSort(o.value)}
                className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[15px] text-zinc-200 transition hover:bg-white/5"
              >
                {o.label}
                {search.sort === o.value && (
                  <svg viewBox="0 0 20 20" className="h-4 w-4 text-brand-300" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                    <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {search.rarities.length > 1 && (
            <>
              <SheetLabel>Rarity</SheetLabel>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={search.rarity === null} onClick={() => search.setRarity(null)} className={chip(search.rarity === null)}>
                  Any
                </button>
                {search.rarities.map((r) => (
                  <button key={r} type="button" aria-pressed={search.rarity === r} onClick={() => search.setRarity(search.rarity === r ? null : r)} className={chip(search.rarity === r)}>
                    {r}
                  </button>
                ))}
              </div>
            </>
          )}

          <SheetLabel>Narrow these results</SheetLabel>
          <input
            type="search"
            value={search.filter}
            onChange={(e) => search.setFilter(e.target.value)}
            placeholder="Name, number or set"
            aria-label="Filter the cards shown"
            className="h-11 w-full rounded-xl border border-edge bg-black/40 px-3.5 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
          />
        </div>
        <div className="border-t border-edge px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
          <button type="button" onClick={onClose} className="h-13 w-full rounded-2xl bg-brand-500 text-base font-bold text-white transition hover:bg-brand-400">
            {n === 0 ? "Close" : `Show ${n.toLocaleString("en-US")} ${n === 1 ? "card" : "cards"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: CardSearchView; onChange: (v: CardSearchView) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="flex h-9 shrink-0 overflow-hidden rounded-xl border border-edge">
      {(["list", "grid"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          aria-label={v === "list" ? "List" : "Grid"}
          onClick={() => onChange(v)}
          className={`flex w-9 items-center justify-center transition ${view === v ? "bg-surface-3 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          {v === "list" ? (
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M4 5.5h12M4 10h12M4 14.5h12" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <rect x="3" y="3" width="6" height="6" rx="1.2" />
              <rect x="11" y="3" width="6" height="6" rx="1.2" />
              <rect x="3" y="11" width="6" height="6" rx="1.2" />
              <rect x="11" y="11" width="6" height="6" rx="1.2" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

export function CardSearchResults({
  search,
  hint,
  views = false,
  footnote,
  children,
}: {
  search: CardSearch;
  /** What a tap does, when the page needs to say ("tap one to add it"). */
  hint?: string;
  /** Offer the list / grid switch (the page's children read `view`). */
  views?: boolean;
  /** Small print under the last card (Search: the affiliate line, Chris 10-14 "hide it at the bottom"). */
  footnote?: ReactNode;
  /** The page's own tiles for the cards on screen. */
  children: (cards: PokemonCard[], view: CardSearchView) => ReactNode;
}) {
  const [sheet, setSheet] = useState(false);
  if (search.results.length === 0) return null;
  const onScreen = search.shown.slice(0, search.limit);
  const more = search.shown.length - onScreen.length;
  const sortLabel = sortOptions(search.mode).find((o) => o.value === search.sort)?.label ?? "Sort";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
          {search.filtering ? `${search.shown.length.toLocaleString("en-US")} of ${search.results.length.toLocaleString("en-US")} cards` : search.title}
        </p>
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-edge bg-surface-2 px-3.5 text-[13px] font-semibold text-white transition hover:border-edge-strong"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 3.5v13M6 16.5l-2.5-2.5M6 16.5L8.5 14M14 16.5v-13M14 3.5L11.5 6M14 3.5L16.5 6" />
          </svg>
          {sortLabel}
          {search.filtering && <span className="h-1.5 w-1.5 rounded-full bg-brand-300" aria-label="filtered" />}
        </button>
        {views && <ViewToggle view={search.view} onChange={search.setView} />}
      </div>
      {hint && <p className="-mt-1 text-xs text-zinc-500">{hint}</p>}
      {search.shown.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-surface-1 px-4 py-6 text-center text-sm text-zinc-400">Nothing matches that filter.</p>
      ) : (
        children(onScreen, search.view)
      )}
      {more > 0 && (
        <button
          type="button"
          onClick={() => search.setLimit((n) => n + PAGE)}
          className="h-12 w-full rounded-2xl border border-edge bg-surface-1 text-sm font-semibold text-white transition hover:border-edge-strong"
        >
          Show {Math.min(PAGE, more)} more
        </button>
      )}
      {footnote}
      {sheet && <SortSheet search={search} onClose={() => setSheet(false)} />}
    </div>
  );
}
