"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import { confirmAction } from "@/components/ConfirmDialog";
import CardImage from "@/components/CardImage";
import CardTile from "@/components/CardTile";
import SetBrowser from "@/components/SetBrowser";
import CardDetailModal from "@/components/CardDetailModal";
import GameToggle from "@/components/GameToggle";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { fetchCardById, searchCards } from "@/lib/cards";
import { filterByPrintedNumber, parseCardQuery } from "@/lib/cardNumber";
import { displayCardNumber, parseMtgQuery, readSavedGame, saveGame } from "@/lib/games";
import { pickPrice } from "@/lib/listing";
import {
  clearPriceChecks,
  deletePriceCheck,
  fetchPriceCheckHistory,
  logPriceCheck,
  type PriceCheckEntry,
} from "@/lib/client/priceChecksApi";
import { toast } from "@/components/Toaster";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Mode = "search" | "browse";
type SearchView = "grid" | "list";
const VIEW_KEY = "cardflip.searchView";

type SortKey = "set" | "price-desc" | "price-asc" | "name" | "rarity";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "set", label: "Set order" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "rarity", label: "Rarity" },
  { value: "name", label: "Name A–Z" },
];

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
const marketOf = (card: PokemonCard): number => pickPrice(card)?.market ?? -1;
function sortCards(cards: PokemonCard[], sort: SortKey): PokemonCard[] {
  if (sort === "set") return cards;
  const out = [...cards];
  switch (sort) {
    case "price-desc": out.sort((a, b) => marketOf(b) - marketOf(a)); break;
    case "price-asc": out.sort((a, b) => (marketOf(a) < 0 ? 1 : marketOf(b) < 0 ? -1 : marketOf(a) - marketOf(b))); break;
    case "name": out.sort((a, b) => a.name.localeCompare(b.name)); break;
    case "rarity": out.sort((a, b) => rarityRank(b) - rarityRank(a) || marketOf(b) - marketOf(a)); break;
  }
  return out;
}

/**
 * Search cards (09-03 makeover, Chris): two ways in — type a name or
 * number, or pick a set from a dropdown and see every card in it. Both
 * land in the same grid, and a tile opens the same price modal.
 */
export default function PriceCheckPage() {
  const { user } = useSession();

  // English-only for now — the ja/zh pipeline underneath still works;
  // restoring <LanguageToggle> here re-enables it.
  const language: ScanLanguage = "en";
  // Same per-browser game choice as the scanner.
  const [game, setGameState] = useState<GameId>(readSavedGame);
  function setGame(next: GameId) {
    setGameState(next);
    setResults([]);
    setResultsTitle(null);
    setSelected(null);
    saveGame(next);
  }
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<PokemonCard[]>([]);
  // What the grid is showing: "184 results for Charizard" / "All 182 cards in Destined Rivals".
  const [resultsTitle, setResultsTitle] = useState<string | null>(null);
  const [selected, setSelected] = useState<PokemonCard | null>(null);
  const [logging, setLogging] = useState(false);
  // Sort + in-grid filter (Chris, 09-03: "some sort options here, like
  // rarity, price high to low"). Client-side — the set is already loaded.
  const [sort, setSort] = useState<SortKey>("set");
  const [gridQuery, setGridQuery] = useState("");


  const [history, setHistory] = useState<PriceCheckEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyQuery, setHistoryQuery] = useState("");
  // Image | Text for the lookups (Chris, 09-04: "need a card to list view"),
  // same switch as Inventory, remembered per browser.
  const [view, setView] = useState<SearchView>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  function chooseView(next: SearchView) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private mode: the choice just doesn't stick.
    }
  }
  // History row whose card is being re-fetched after a click.
  const [openingId, setOpeningId] = useState<string | null>(null);
  // Search sequence: a slow older response must not overwrite a newer one
  // (fire two searches fast and the first can land last).
  const searchSeq = useRef(0);

  const loadHistory = useCallback(() => {
    fetchPriceCheckHistory()
      .then(setHistory)
      .finally(() => setHistoryLoading(false));
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    loadHistory();
  }, [userId, loadHistory]);

  async function handleSearch() {
    if (!query.trim()) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    try {
      // Sellers type what's printed on the card they're holding — "Charizard
      // 4/102". Splitting the fraction out makes that the most precise query
      // the lookup can take, instead of a name that matches nothing.
      let found: PokemonCard[];
      if (game === "mtg") {
        const { name, number, setCode } = parseMtgQuery(query);
        const printed = number || setCode ? { number: number ?? "", setTotal: null, setCode, isSecretRare: false } : null;
        found = await searchCards(name, printed, language, 200, "mtg");
        if (number) {
          const wanted = number.replace(/^0+(?=\d)/, "");
          const exact = found.filter((c) => c.number.replace(/^0+(?=\d)/, "").toLowerCase() === wanted);
          if (exact.length > 0) found = exact;
        }
      } else {
        const { name, printed } = parseCardQuery(query);
        // Every printing, not the scanner's top-24 — same as the wishlist search.
        // But a typed number is deliberate: show only the card it names.
        found = filterByPrintedNumber(
          await searchCards(name, printed, language, 200),
          printed,
        );
      }
      if (seq !== searchSeq.current) return;
      setResults(found);
      setResultsTitle(
        found.length > 0
          ? `${found.length} result${found.length === 1 ? "" : "s"} for “${query.trim()}”`
          : null,
      );
      if (found.length === 0) setSearchError("No cards matched that search.");
    } catch {
      if (seq !== searchSeq.current) return;
      setSearchError("Search failed — check your connection.");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  function clearResults() {
    setGridQuery("");
    setResults([]);
    setResultsTitle(null);
    setSelected(null);
    setSearchError(null);
    setQuery("");
  }

  async function selectCard(card: PokemonCard) {
    setSelected(card);
    setLogging(true);
    await logPriceCheck(card, language);
    setLogging(false);
    loadHistory();
  }

  /** A history row is a shortcut back to its card: re-look it up (prices go
   * stale, so a cached copy would lie) and open the same modal as a search. */
  async function openHistoryEntry(entry: PriceCheckEntry) {
    if (openingId) return;
    setOpeningId(entry.id);
    try {
      // Rows that stored the catalog id fetch it directly — the ranked
      // 200-result name walk was seconds of spinner (09-02, same fix as
      // the wishlist tile).
      if (entry.cardId) {
        const direct = await fetchCardById(entry.cardId, entry.game ?? game).catch(() => null);
        if (direct) {
          await selectCard(direct);
          return;
        }
      }
      const found = await searchCards(
        entry.cardName,
        entry.cardNumber,
        entry.language,
        200,
        entry.game ?? game,
      );
      // Old rows have no cardId — the top match for the stored name+number is
      // the best available guess there.
      const match = entry.cardId
        ? (found.find((c) => c.id === entry.cardId) ?? found[0])
        : found[0];
      if (match) {
        await selectCard(match);
      } else {
        setSearchError("Couldn't find that card again — try searching above.");
      }
    } catch {
      setSearchError("Search failed — check your connection.");
    } finally {
      setOpeningId(null);
    }
  }

  async function removeEntry(entry: PriceCheckEntry) {
    // Optimistic; the row comes back if the server didn't delete it.
    setHistory((prev) => prev.filter((e) => e.id !== entry.id));
    const ok = await deletePriceCheck(entry.id);
    if (!ok) {
      setHistory((prev) => [entry, ...prev]);
      toast(`Couldn't remove ${entry.cardName}`, "err");
    }
  }

  async function clearHistory() {
    if (!(await confirmAction({ message: `Clear all ${history.length} lookups? This can't be undone.`, confirmLabel: "Clear all" }))) return;
    const before = history;
    setHistory([]);
    const ok = await clearPriceChecks();
    if (!ok) {
      setHistory(before);
      toast("Couldn't clear the history — try again", "err");
      return;
    }
    toast("Lookup history cleared");
  }

  const gridNeedle = gridQuery.trim().toLowerCase();
  const shown = sortCards(
    gridNeedle
      ? results.filter((c) =>
          `${c.name} ${c.englishName ?? ""} ${c.number} ${c.rarity ?? ""} ${c.setName}`.toLowerCase().includes(gridNeedle),
        )
      : results,
    sort,
  );

  const visibleHistory = historyQuery.trim()
    ? history.filter((entry) =>
        `${entry.cardName} ${entry.setName} ${entry.cardNumber}`
          .toLowerCase()
          .includes(historyQuery.trim().toLowerCase()),
      )
    : history;

  if (!user) return <PageSkeleton />;

  const modePill = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(value);
        setSearchError(null);
      }}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
        mode === value ? "bg-brand-500 text-white" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Search cards</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Look up any card&apos;s worth across every price source we have, or open a
          whole set — no photo needed.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-surface-1 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <GameToggle game={game} onChange={setGame} compact />
          <div className="flex items-center gap-1 rounded-full border border-edge bg-black/30 p-1">
            {modePill("search", "By name")}
            {modePill("browse", "By set")}
          </div>
        </div>

        {mode === "search" ? (
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={game === "mtg" ? "Name or number — e.g. Lightning Bolt LTR 187" : "Name or number — e.g. Charizard 4/102"}
              className="flex-1 rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
            >
              {searching && <Spinner className="h-4 w-4" />}
              Search
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Shared with Watchlist (components/SetBrowser). */}
            <SetBrowser
              key={game}
              game={game}
              onBusy={setSearching}
              onError={setSearchError}
              onResults={(cards, title) => {
                ++searchSeq.current;
                setSelected(null);
                setResults(cards);
                setResultsTitle(title);
              }}
            />
            <p className="text-[11px] text-zinc-600">
              Newest sets first. Every card in the set, in printed order, with the latest price we hold.
            </p>
          </div>
        )}
        {searchError && <p className="text-xs text-red-400">{searchError}</p>}
      </div>

      {results.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-400">
              <span className="font-medium text-zinc-200">{resultsTitle}</span>
              {gridNeedle ? (
                <span className="text-zinc-600"> · showing {shown.length}</span>
              ) : (
                <span className="text-zinc-600"> · tap a card for its prices</span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={gridQuery}
                onChange={(e) => setGridQuery(e.target.value)}
                placeholder="Filter these cards…"
                aria-label="Filter the cards shown"
                className="w-40 rounded-lg border border-edge bg-black/40 px-3 py-1.5 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
              />
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  aria-label="Sort cards"
                  className="appearance-none rounded-lg border border-edge bg-black/40 py-1.5 pl-3 pr-7 text-xs text-zinc-200 outline-none transition focus:border-brand-400"
                >
                  {SORTS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500">▾</span>
              </div>
              <button
                onClick={clearResults}
                className="shrink-0 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
              >
                ✕ Clear
              </button>
            </div>
          </div>
          {shown.length === 0 && (
            <p className="rounded-xl border border-edge bg-surface-1 px-4 py-6 text-center text-sm text-zinc-500">
              Nothing matches that filter.
            </p>
          )}
          {/* The Watchlist's card tile (components/CardTile) — Chris, 09-04:
              "I love the card view, push that into Search cards". */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((card) => {
              const price = pickPrice(card);
              return (
                <CardTile
                  key={card.id}
                  imageUrl={card.imageSmall}
                  name={card.name}
                  englishName={card.englishName}
                  subtitle={mode === "browse" ? displayCardNumber(card) : `${card.setName} · ${displayCardNumber(card)}`}
                  price={price?.market ?? null}
                  priceNote={price?.label ? `${price.label} · market` : undefined}
                  aside={card.rarity ? <span className="max-w-[45%] truncate rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">{card.rarity}</span> : undefined}
                  selected={selected?.id === card.id}
                  onOpen={() => void selectCard(card)}
                />
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <CardDetailModal
          card={selected}
          language={language}
          logging={logging}
          onClose={() => setSelected(null)}
        />
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Recent lookups · {history.length}
          </h2>
          {history.length > 0 && (
            <div className="flex items-center gap-2">
              <div
                role="tablist"
                aria-label="Switch view"
                className="relative grid h-9 w-[84px] shrink-0 grid-cols-2 rounded-full border border-edge bg-black/25 p-1 sm:w-[132px]"
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-brand-500 shadow-md shadow-brand-500/30 transition-transform duration-200 ease-out ${
                    view === "list" ? "translate-x-full" : ""
                  }`}
                />
                {(["grid", "list"] as SearchView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    aria-label={v === "grid" ? "Image view" : "Text view"}
                    onClick={() => chooseView(v)}
                    className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition-colors ${
                      view === v ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {v === "grid" ? (
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                        <rect x="3" y="3" width="6" height="6" rx="1.2" />
                        <rect x="11" y="3" width="6" height="6" rx="1.2" />
                        <rect x="3" y="11" width="6" height="6" rx="1.2" />
                        <rect x="11" y="11" width="6" height="6" rx="1.2" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                        <path d="M4 5.5h12M4 10h12M4 14.5h12" />
                      </svg>
                    )}
                    <span className="hidden sm:inline">{v === "grid" ? "Image" : "Text"}</span>
                  </button>
                ))}
              </div>
              <input
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Filter lookups…"
                className="rounded-lg border border-edge bg-black/40 px-3 py-1.5 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
              />
              <button
                onClick={() => void clearHistory()}
                className="rounded-lg border border-edge px-3 py-1.5 text-xs text-zinc-400 transition hover:border-edge-strong hover:text-zinc-200"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
        {view === "grid" ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {visibleHistory.map((entry) => (
              <CardTile
                key={entry.id}
                imageUrl={entry.imageUrl ?? ""}
                name={entry.cardName}
                subtitle={`${entry.setName} · ${entry.cardNumber}${entry.language !== "en" ? ` · ${entry.language === "ja" ? "Japanese" : "Chinese"}` : ""}`}
                price={entry.representativePrice}
                priceNote={formatDate(entry.checkedAt)}
                opening={openingId === entry.id}
                onOpen={() => void openHistoryEntry(entry)}
                corner={
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeEntry(entry);
                    }}
                    aria-label={`Remove ${entry.cardName} from history`}
                    title="Remove from history"
                    className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-zinc-400 transition hover:bg-black/80 hover:text-white focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
                    </svg>
                  </button>
                }
              />
            ))}
            {visibleHistory.length === 0 && (
              <p className="col-span-full rounded-xl border border-edge bg-surface-1 px-4 py-6 text-center text-sm text-zinc-500">
                {history.length === 0 ? "Cards you look up land here." : "Nothing matches that filter."}
              </p>
            )}
          </div>
        ) : (
        <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
          <ul className="divide-y divide-white/5">
            {visibleHistory.map((entry) => (
              <li
                key={entry.id}
                onClick={() => void openHistoryEntry(entry)}
                title="Open this card"
                className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-white/5"
              >
                <CardImage
                  src={entry.imageUrl ?? ""}
                  alt={entry.cardName}
                  className="h-16 w-12 shrink-0 rounded-md"
                />
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <span className="truncate">{entry.cardName}</span>
                    {openingId === entry.id && <Spinner className="h-3 w-3 shrink-0" />}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {entry.setName} · {entry.cardNumber}
                    {entry.language !== "en" &&
                      ` · ${entry.language === "ja" ? "Japanese" : "Chinese"}`}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <span className="block font-display font-medium text-emerald-400">
                      {entry.representativePrice != null
                        ? `$${entry.representativePrice.toFixed(2)}`
                        : "—"}
                    </span>
                    <span className="block text-[11px] text-zinc-600">
                      {formatDate(entry.checkedAt)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      // The row itself opens the card — deleting shouldn't.
                      e.stopPropagation();
                      void removeEntry(entry);
                    }}
                    aria-label={`Remove ${entry.cardName} from history`}
                    title="Remove from history"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-600 transition hover:bg-white/5 hover:text-zinc-300"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
            {visibleHistory.length === 0 && (
              <li className="px-4 py-6 text-center text-zinc-500">
                {historyLoading
                  ? "Loading your lookups…"
                  : history.length > 0
                    ? "Nothing matches that filter."
                    : "No lookups yet — search for a card or open a set above."}
              </li>
            )}
          </ul>
        </div>
        )}
      </section>
    </main>
  );
}
