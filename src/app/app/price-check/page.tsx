"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import CardImage from "@/components/CardImage";
import CardDetailModal from "@/components/CardDetailModal";
import GameToggle from "@/components/GameToggle";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { searchCards } from "@/lib/cards";
import { filterByPrintedNumber, parseCardQuery } from "@/lib/cardNumber";
import { displayCardNumber, parseMtgQuery, readSavedGame, saveGame } from "@/lib/games";
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
    setSelected(null);
    saveGame(next);
  }
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<PokemonCard[]>([]);
  const [selected, setSelected] = useState<PokemonCard | null>(null);
  const [logging, setLogging] = useState(false);

  const [history, setHistory] = useState<PriceCheckEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyQuery, setHistoryQuery] = useState("");
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
          const wanted = number.replace(/^0+(?=d)/, "");
          const exact = found.filter((c) => c.number.replace(/^0+(?=d)/, "").toLowerCase() === wanted);
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
      if (found.length === 0) setSearchError("No cards matched that search.");
    } catch {
      if (seq !== searchSeq.current) return;
      setSearchError("Search failed — check your connection.");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
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
    if (!window.confirm(`Clear all ${history.length} lookups? This can't be undone.`)) return;
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

  const visibleHistory = historyQuery.trim()
    ? history.filter((entry) =>
        `${entry.cardName} ${entry.setName} ${entry.cardNumber}`
          .toLowerCase()
          .includes(historyQuery.trim().toLowerCase()),
      )
    : history;

  if (!user) return <PageSkeleton />;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Search cards</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Look up any card&apos;s worth across every price source we have —
          no photo needed.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-1 p-5">
        <GameToggle game={game} onChange={setGame} compact />
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
        {searchError && <p className="text-xs text-red-400">{searchError}</p>}
      </div>

      {results.length > 0 && (
        <div className="flex flex-col gap-3">
          {/* Same escape hatch as the watchlist search: a big result grid
              buries the lookup history below it. */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">
              {results.length} result{results.length === 1 ? "" : "s"} — pick one for its prices
            </p>
            <button
              onClick={() => {
                setResults([]);
                setSelected(null);
                setSearchError(null);
                setQuery("");
              }}
              className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
            >
              ✕ Clear results
            </button>
          </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {results.map((card) => (
            <button
              key={card.id}
              onClick={() => selectCard(card)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 ${
                selected?.id === card.id
                  ? "border-brand-400 bg-brand-500/10"
                  : "border-edge bg-surface-1 hover:border-edge-strong"
              }`}
            >
              <CardImage
                src={card.imageSmall}
                alt={card.name}
                className="aspect-[5/7] w-full rounded-lg"
              />
              <span className="w-full truncate text-xs font-medium text-white">
                {card.name}
              </span>
              {card.englishName && (
                <span className="w-full truncate text-[11px] font-medium text-brand-300">
                  {card.englishName}
                </span>
              )}
              <span className="w-full truncate text-[11px] text-zinc-500">
                {card.setName} · {displayCardNumber(card)}
              </span>
            </button>
          ))}
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Recent lookups ({history.length})
          </h2>
          {history.length > 0 && (
            <div className="flex items-center gap-2">
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
        <div className="overflow-x-auto rounded-2xl border border-edge bg-surface-1">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3 font-medium">Card</th>
                <th className="px-4 py-3 font-medium">Language</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Checked</th>
                <th className="px-2 py-3" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {visibleHistory.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => void openHistoryEntry(entry)}
                  title="Open this card"
                  className="cursor-pointer border-b border-white/5 transition last:border-0 hover:bg-white/5"
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 font-medium text-white">
                      {entry.cardName}
                      {openingId === entry.id && <Spinner className="h-3 w-3" />}
                    </span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {entry.setName} · {entry.cardNumber}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {entry.language === "en"
                      ? "English"
                      : entry.language === "ja"
                        ? "Japanese"
                        : "Chinese"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-white">
                    {entry.representativePrice != null
                      ? `$${entry.representativePrice.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {formatDate(entry.checkedAt)}
                  </td>
                  <td className="px-2 py-3 text-right">
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
                  </td>
                </tr>
              ))}
              {visibleHistory.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                    {historyLoading
                      ? "Loading your lookups…"
                      : history.length > 0
                        ? "Nothing matches that filter."
                        : "No lookups yet — search for a card above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
