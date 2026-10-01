"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "@/components/Spinner";
import { confirmAction } from "@/components/ConfirmDialog";
import CardImage from "@/components/CardImage";
import CardTile from "@/components/CardTile";
import { CardSearchBox, CardSearchResults, useCardSearch } from "@/components/CardSearch";
import CardDetailModal from "@/components/CardDetailModal";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { fetchCardById, searchCards } from "@/lib/cards";
import { displayCardNumber } from "@/lib/games";
import { formatMoney, pickPrice, priceFlagOf } from "@/lib/listing";
import { PriceFlagText } from "@/components/PriceFlagNote";
import {
  clearPriceChecks,
  deletePriceCheck,
  fetchPriceCheckHistory,
  logPriceCheck,
  type PriceCheckEntry,
} from "@/lib/client/priceChecksApi";
import { toast } from "@/components/Toaster";
import type { PokemonCard, ScanLanguage } from "@/lib/types";
import { etDateTime } from "@/lib/time";

/** "Sep 30, 6:22 AM ET" — Eastern for every viewer (Chris 09-30). */
function formatDate(ts: number): string {
  return etDateTime(ts);
}

type SearchView = "grid" | "list";
const VIEW_KEY = "cardflip.searchView";

/**
 * Search cards (09-03 makeover, Chris): two ways in — type a name or
 * number, or pick a set from a dropdown and see every card in it. Both
 * land in the same grid, and a tile opens the same price modal. The search
 * itself is shared with the Watchlist (components/CardSearch).
 */
export default function PriceCheckPage() {
  const { user } = useSession();

  // English-only for now — the ja/zh pipeline underneath still works;
  // restoring <LanguageToggle> here re-enables it.
  const language: ScanLanguage = "en";
  const [selected, setSelected] = useState<PokemonCard | null>(null);
  const search = useCardSearch(language, () => setSelected(null));
  const { game, mode } = search;
  const setSearchError = search.setError;
  // The modal is open on what the history row knows while the catalog row
  // (current prices) is still on its way.
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [logging, setLogging] = useState(false);

  const [history, setHistory] = useState<PriceCheckEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // History couldn't load (offline, 5xx) — not the same as "no lookups yet".
  const [historyError, setHistoryError] = useState<string | null>(null);
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

  const loadHistory = useCallback(() => {
    fetchPriceCheckHistory()
      .then((entries) => {
        setHistory(entries);
      })
      .catch(() => {
        setHistoryError("Couldn't load your lookups — check your connection.");
      })
      .finally(() => setHistoryLoading(false));
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    loadHistory();
  }, [userId, loadHistory]);

  async function selectCard(card: PokemonCard) {
    setSelected(card);
    setSelectedLoading(false);
    setLogging(true);
    await logPriceCheck(card, language);
    setLogging(false);
    loadHistory();
  }

  /** What a history row already knows, shaped for the modal — shown the
   * instant the tile is tapped (09-10: the tile sat on a spinner for 5s+
   * with nothing on screen). Prices are left empty: the stored ones are
   * stale, and the modal says "Loading current prices…" until the catalog
   * row lands. */
  function stubCard(entry: PriceCheckEntry): PokemonCard {
    return {
      id: entry.cardId ?? "",
      name: entry.cardName,
      englishName: null,
      setName: entry.setName,
      setSeries: "",
      number: entry.cardNumber,
      rarity: null,
      imageSmall: entry.imageUrl ?? "",
      imageLarge: entry.imageUrl ?? "",
      prices: [],
      ...(entry.game ? { game: entry.game } : {}),
    };
  }

  /** A history row is a shortcut back to its card: re-look it up (prices go
   * stale, so a cached copy would lie) and open the same modal as a search. */
  async function openHistoryEntry(entry: PriceCheckEntry) {
    if (openingId) return;
    setOpeningId(entry.id);
    setSearchError(null);
    setSelected(stubCard(entry));
    setSelectedLoading(true);
    try {
      // Rows that stored the catalog id fetch it directly — the ranked
      // 200-result name walk was seconds of spinner (09-02, same fix as
      // the wishlist tile).
      if (entry.cardId) {
        const direct = await fetchCardById(entry.cardId, entry.game ?? game).catch(() => null);
        if (direct) {
          setOpeningId(null);
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
        setSelected(null);
        setSearchError("Couldn't find that card again — try searching above.");
      }
    } catch {
      setSelected(null);
      setSearchError("Search failed — check your connection.");
    } finally {
      setSelectedLoading(false);
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
        <h1 className="font-display text-2xl font-semibold text-white">Search cards</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Look up any card&apos;s worth across every price source we have, or open a
          whole set — no photo needed.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-surface-1 p-5">
        <CardSearchBox
          search={search}
          hint={mode === "browse" ? "Newest sets first. Every card in the set, in printed order, with the latest price we hold." : undefined}
        />
      </div>

      <CardSearchResults search={search} hint="tap a card for its prices">
        {(shown) => (
          /* The Watchlist's card tile (components/CardTile) — Chris, 09-04:
             "I love the card view, push that into Search cards". */
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((card) => {
              const price = pickPrice(card);
              const flagged = priceFlagOf(card) != null;
              return (
                <CardTile
                  key={card.id}
                  imageUrl={card.imageSmall}
                  name={card.name}
                  englishName={card.englishName}
                  subtitle={mode === "browse" ? displayCardNumber(card) : `${card.setName} · ${displayCardNumber(card)}`}
                  price={flagged ? null : (price?.market ?? null)}
                  priceNote={price?.label ? `${price.label} · market` : undefined}
                  flagged={flagged}
                  aside={card.rarity ? <span className="max-w-[45%] truncate rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">{card.rarity}</span> : undefined}
                  selected={selected?.id === card.id}
                  onOpen={() => void selectCard(card)}
                />
              );
            })}
          </div>
        )}
      </CardSearchResults>

      {selected && (
        <CardDetailModal
          card={selected}
          language={language}
          logging={logging}
          loading={selectedLoading}
          onClose={() => { setSelected(null); setSelectedLoading(false); }}
        />
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Recent lookups · {history.length}
          </h2>
          {history.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
                aria-label="Filter lookups"
                className="min-w-0 flex-1 rounded-lg border border-edge bg-black/40 px-3 py-1.5 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:w-40 sm:flex-none"
              />
              <button
                onClick={() => void clearHistory()}
                className="shrink-0 whitespace-nowrap rounded-lg border border-edge px-3 py-1.5 text-xs text-zinc-400 transition hover:border-edge-strong hover:text-zinc-200"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
        {historyError && history.length === 0 ? (
          <p
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300"
          >
            <span>{historyError}</span>
            <button
              type="button"
              onClick={() => {
                setHistoryError(null);
                setHistoryLoading(true);
                loadHistory();
              }}
              className="rounded-full border border-red-400/40 px-3 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
            >
              Retry
            </button>
          </p>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {visibleHistory.map((entry) => (
              <CardTile
                key={entry.id}
                imageUrl={entry.imageUrl ?? ""}
                name={entry.cardName}
                subtitle={`${entry.setName} · ${entry.cardNumber}${entry.language !== "en" ? ` · ${entry.language === "ja" ? "Japanese" : "Chinese"}` : ""}`}
                price={entry.flag ? null : entry.representativePrice}
                priceNote={formatDate(entry.checkedAt)}
                flagged={Boolean(entry.flag)}
                sparkCardId={entry.cardId}
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
                    <span className="line-clamp-2 leading-snug [overflow-wrap:anywhere]">{entry.cardName}</span>
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
                    {entry.flag ? (
                      <span className="block max-w-[11rem] text-xs font-medium leading-snug"><PriceFlagText /></span>
                    ) : (
                      <span className="block font-display font-medium text-emerald-400">
                        {formatMoney(entry.representativePrice)}
                      </span>
                    )}
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
                    className="-my-1.5 flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 transition hover:bg-white/5 hover:text-zinc-300"
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
