"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CardImage from "@/components/CardImage";
import CardDetailModal from "@/components/CardDetailModal";
import Spinner from "@/components/Spinner";
import GameToggle from "@/components/GameToggle";
import PriceSparkline from "@/components/PriceSparkline";
import { toast } from "@/components/Toaster";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import {
  addToWishlist,
  fetchWishlist,
  removeFromWishlist,
  setWishlistAlert,
  type WishlistItem,
} from "@/lib/client/wishlistApi";
import { identifyCardImage } from "@/lib/client/identifyCard";
import { fetchCardById, searchCards } from "@/lib/cards";
import { pickPrice } from "@/lib/listing";
import {
  filterByPrintedNumber,
  normalizeNumber,
  parseCardQuery,
} from "@/lib/cardNumber";
import { displayCardNumber, parseMtgQuery, readSavedGame, saveGame } from "@/lib/games";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * "Email me when it dips to $X" — one target per row, one email per hit
 * (the daily job re-arms only when the target changes). Needs a catalog id:
 * the alert sweep reads our own price history, keyed by card_id.
 */
function AlertControl({ item, onSaved }: { item: WishlistItem; onSaved: (item: WishlistItem) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.alertPrice != null ? String(item.alertPrice) : "");
  const [busy, setBusy] = useState(false);

  async function save(target: number | null) {
    setBusy(true);
    const saved = await setWishlistAlert(item.id, target);
    setBusy(false);
    if (!saved) {
      toast("Couldn't save the alert — try again");
      return;
    }
    onSaved(saved);
    setEditing(false);
    toast(target != null ? `Alert set — email at $${target.toFixed(2)}` : "Alert removed");
  }

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = parseFloat(value);
          if (Number.isFinite(n) && n > 0) void save(Math.round(n * 100) / 100);
          else toast("Type the price you want to be told about", "err");
        }}
        className="flex flex-col items-center gap-1.5"
      >
        <p className="text-xs leading-snug text-zinc-400">
          We email you when the market dips to this price (checked daily).
        </p>
        <div className="flex items-center gap-1.5">
        <span className="text-sm text-zinc-400">$</span>
        <input
          autoFocus
          onFocus={(e) => e.target.select()}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={item.price != null ? item.price.toFixed(2) : "0.00"}
          className="w-24 rounded-md border border-edge bg-black/40 px-2.5 py-2 text-center text-base text-white outline-none focus:border-brand-400"
          aria-label={`Alert price for ${item.cardName}`}
        />
        <button type="submit" disabled={busy} className="rounded-full bg-brand-500/15 px-3.5 py-2 text-sm font-medium text-brand-300 hover:bg-brand-500/25 disabled:opacity-50">
          Set
        </button>
        {item.alertPrice != null && (
          <button type="button" disabled={busy} onClick={() => void save(null)} className="px-1.5 text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-300">
            Clear
          </button>
        )}
        </div>
      </form>
    );
  }
  return (
    <button
      onClick={() => {
        // Prefill with something real: the current alert, else today's price.
        // An empty box behind a grey placeholder read as a value that
        // "couldn't be changed" (Chris, 09-01).
        setValue(
          item.alertPrice != null
            ? String(item.alertPrice)
            : item.price != null
              ? item.price.toFixed(2)
              : "",
        );
        setEditing(true);
      }}
      title="Get an email when this card's market price dips to your target"
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
        item.alertPrice != null
          ? "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
          : "border-edge text-zinc-500 hover:border-edge-strong hover:text-zinc-300"
      }`}
    >
      {item.alertPrice != null
        ? `🔔 Alert at $${item.alertPrice.toFixed(2)}${item.alertedAt ? " · sent" : ""}`
        : "🔔 Price alert"}
    </button>
  );
}

/**
 * Wishlist items freeze the price at the moment they were saved, which is what
 * makes them useful as a watch list: re-pricing them on load turns each one
 * into "what it was then vs what it is now". English-only because that's the
 * only catalogue with market pricing attached.
 */
const REPRICE_LIMIT = 15;

interface Repriced {
  /** item.id → current USD market */
  prices: Record<string, number>;
  /** item.id → catalog id, for rows saved before `cardId` was stored (sparklines). */
  cardIds: Record<string, string>;
  /** item.id → the resolved catalog card, so a tile tap opens without a fetch. */
  cards: Record<string, PokemonCard>;
}

/** What the tile already knows about its card, shaped for the detail modal —
 * shown the instant a tile is tapped while the catalog row loads (09-04:
 * "opening the larger view is delayed"). */
function stubCard(item: WishlistItem): PokemonCard {
  return {
    id: item.cardId ?? "",
    name: item.cardName,
    englishName: item.englishName,
    setName: item.setName,
    setSeries: "",
    number: item.cardNumber,
    rarity: null,
    imageSmall: item.imageUrl,
    imageLarge: item.imageUrl,
    prices: [],
    ...(item.game ? { game: item.game } : {}),
  };
}

/** Find the catalog card behind a saved row — the same match walk the
 * repricing pass uses (id first, then exact name+number, then top hit). */
async function resolveWishlistCard(item: WishlistItem): Promise<PokemonCard | null> {
  // Rows that stored the catalog id skip the name walk entirely — the
  // "Charizard" search was seconds of spinner on the tile (09-02).
  if (item.cardId) {
    const direct = await fetchCardById(item.cardId, item.game ?? "pokemon").catch(() => null);
    if (direct) return direct;
  }
  const cards = await searchCards(
    item.cardName,
    item.cardNumber || null,
    item.language,
    undefined,
    item.game ?? "pokemon",
  );
  return (
    (item.cardId ? cards.find((c) => c.id === item.cardId) : null) ??
    cards.find(
      (c) =>
        c.name === item.cardName &&
        (!item.cardNumber ||
          normalizeNumber(c.number) === normalizeNumber(item.cardNumber)),
    ) ??
    cards[0] ??
    null
  );
}

async function fetchCurrentPrices(items: WishlistItem[]): Promise<Repriced> {
  const targets = items
    .filter((item) => item.language === "en" && item.price != null)
    .slice(0, REPRICE_LIMIT);

  const prices: Record<string, number> = {};
  const cardIds: Record<string, string> = {};
  const resolved: Record<string, PokemonCard> = {};
  await Promise.all(
    targets.map(async (item) => {
      try {
        // MTG rows carry a game; older rows are Pokémon (the only game then).
        // For MTG the "printed number" is the collector number, same field.
        const cards = await searchCards(item.cardName, item.cardNumber || null, "en", undefined, item.game ?? "pokemon");
        const match =
          (item.cardId ? cards.find((c) => c.id === item.cardId) : null) ??
          cards.find(
            (c) =>
              c.name === item.cardName &&
              (!item.cardNumber ||
                normalizeNumber(c.number) === normalizeNumber(item.cardNumber)),
          ) ?? cards[0];
        if (!match) return;
        resolved[item.id] = match;
        if (!item.cardId && match.id) cardIds[item.id] = match.id;
        const usd = match.prices.find((p) => p.currency === "USD" && p.market != null);
        if (usd?.market != null) prices[item.id] = usd.market;
      } catch {
        // Row keeps its saved price; delta and sparkline just don't show.
      }
    }),
  );
  return { prices, cardIds, cards: resolved };
}

/** Since-saved move as a chip; quiet when under a dollar and 1%. */
function PriceDelta({ saved, now }: { saved: number; now: number }) {
  const delta = now - saved;
  const pct = saved > 0 ? (delta / saved) * 100 : 0;
  if (Math.abs(delta) < 1 && Math.abs(pct) < 1) {
    return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-500">steady</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        up ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
      }`}
      title={`${up ? "Up" : "Down"} since you saved it at $${saved.toFixed(2)}`}
    >
      {up ? "▲" : "▼"} {up ? "+" : "−"}$
      {Math.abs(delta).toFixed(2)} · {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export default function WishlistPage() {
  const { user } = useSession();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowPrices, setNowPrices] = useState<Record<string, number>>({});
  // Catalog ids resolved by the repricing pass for rows that predate `cardId`.
  const [resolvedIds, setResolvedIds] = useState<Record<string, string>>({});
  // Tile click → the same detail modal the price-check page opens. NO scanner
  // handoff (Chris veto: a wishlisted card has no real photo, only stock art).
  const [detail, setDetail] = useState<{ card: PokemonCard; language: ScanLanguage; itemId: string; loading?: boolean } | null>(null);
  // Catalog cards already resolved for the tiles (by the repricing pass or an
  // earlier open) — a tap on one of these opens with no network wait.
  const resolvedCards = useRef<Record<string, PokemonCard>>({});
  const [detailOpeningId, setDetailOpeningId] = useState<string | null>(null);
  const [sort, setSort] = useState<"newest" | "name" | "price-high" | "price-low">("newest");
  const [listFilter, setListFilter] = useState("");

  // The add flow is search or a dropped image — deliberately no camera here:
  // a wishlisted card is one the user *doesn't* have in hand to scan.
  // English-only for now — the ja/zh pipeline underneath still works;
  // restoring <LanguageToggle> here re-enables it.
  const addLanguage: ScanLanguage = "en";
  // Same per-browser game choice as the scanner.
  const [game, setGameState] = useState<GameId>(readSavedGame);
  function setGame(next: GameId) {
    setGameState(next);
    setResults([]);
    saveGame(next);
  }
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"search" | "identify" | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [results, setResults] = useState<PokemonCard[]>([]);
  // Vision may identify a dropped image as a different language than the
  // toggle, so the save has to use what the results actually are.
  const [resultsLanguage, setResultsLanguage] = useState<ScanLanguage>("en");
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchWishlist()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        // Deltas fill in as they arrive; the list never waits on pricing.
        void fetchCurrentPrices(list).then(({ prices, cardIds, cards }) => {
          if (cancelled) return;
          setNowPrices(prices);
          setResolvedIds(cardIds);
          resolvedCards.current = { ...resolvedCards.current, ...cards };
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleRemove(id: string) {
    // Optimistic; put it back where it was if the server didn't delete it.
    const index = items.findIndex((i) => i.id === id);
    const item = items[index];
    setAddError(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
    const ok = await removeFromWishlist(id);
    if (!ok && item) {
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== id);
        next.splice(Math.min(index, next.length), 0, item);
        return next;
      });
      setAddError(`Couldn't remove ${item.cardName ?? "that card"} — check your connection and try again.`);
    }
  }

  async function handleSearch() {
    if (!query.trim() || busy) return;
    setBusy("search");
    setAddError(null);
    setResults([]);
    try {
      let found: PokemonCard[];
      if (game === "mtg") {
        const { name, number, setCode } = parseMtgQuery(query);
        const printed = number || setCode ? { number: number ?? "", setTotal: null, setCode, isSecretRare: false } : null;
        found = await searchCards(name, printed, addLanguage, 200, "mtg");
        if (number) {
          const wanted = number.replace(/^0+(?=d)/, "");
          const exact = found.filter((c) => c.number.replace(/^0+(?=d)/, "").toLowerCase() === wanted);
          if (exact.length > 0) found = exact;
        }
      } else {
        const { name, printed } = parseCardQuery(query);
        // Every printing, not the scanner's top-24 — someone hunting a card
        // wants to see all of them. Unless they typed a number: that's
        // deliberate, so show only the card it names.
        found = filterByPrintedNumber(
          await searchCards(name, printed, addLanguage, 200),
          printed,
        );
      }
      setResults(found);
      setResultsLanguage(addLanguage);
      if (found.length === 0) setAddError("No cards matched that search.");
    } catch {
      setAddError("Search failed — check your connection.");
    } finally {
      setBusy(null);
    }
  }

  async function handleImage(file: File | undefined) {
    if (!file || !file.type.startsWith("image/") || busy) return;
    setBusy("identify");
    setAddError(null);
    setResults([]);
    const outcome = await identifyCardImage(file, addLanguage, game);
    setResults(outcome.cards);
    setResultsLanguage(outcome.language);
    setAddError(outcome.error);
    setBusy(null);
  }

  async function handleAdd(card: PokemonCard) {
    if (addedIds.has(card.id)) return;
    const price = pickPrice(card)?.market ?? null;
    const item = await addToWishlist(card, resultsLanguage, price);
    if (!item) {
      setAddError(`Couldn't add ${card.name} — check your connection and try again.`);
      return;
    }
    setAddedIds((prev) => new Set(prev).add(card.id));
    toast(`${card.name} added to your watchlist`);
    // The server no-ops on duplicates and returns the existing row, so only
    // prepend when it isn't already in the grid.
    setItems((prev) =>
      prev.some((i) => i.id === item.id) ? prev : [item, ...prev],
    );
  }

  async function openDetail(item: WishlistItem) {
    if (detailOpeningId) return;
    setAddError(null);
    const cached = resolvedCards.current[item.id];
    if (cached) {
      setDetail({ card: cached, language: item.language, itemId: item.id });
      return;
    }
    // Open NOW on what the tile knows; the catalog row (prices, history)
    // fills in when it lands. A closed modal is never reopened by the fetch.
    setDetail({ card: stubCard(item), language: item.language, itemId: item.id, loading: true });
    setDetailOpeningId(item.id);
    try {
      const card = await resolveWishlistCard(item);
      if (card) {
        resolvedCards.current[item.id] = card;
        setDetail((d) => (d?.itemId === item.id ? { card, language: item.language, itemId: item.id } : d));
      } else {
        setDetail((d) => (d?.itemId === item.id ? { ...d, loading: false } : d));
        setAddError(`Couldn't find ${item.cardName} in the catalog right now — try again in a moment.`);
      }
    } catch {
      setDetail((d) => (d?.itemId === item.id ? { ...d, loading: false } : d));
      setAddError("Couldn't load that card — check your connection.");
    } finally {
      setDetailOpeningId(null);
    }
  }

  const visibleItems = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    const filtered = q
      ? items.filter((i) =>
          `${i.cardName} ${i.englishName ?? ""} ${i.setName}`.toLowerCase().includes(q),
        )
      : items;
    const sorted = [...filtered];
    if (sort === "name") sorted.sort((a, b) => a.cardName.localeCompare(b.cardName));
    else if (sort === "price-high") sorted.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    else if (sort === "price-low")
      sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    // "newest" keeps the server order (added desc, new saves prepended).
    return sorted;
  }, [items, sort, listFilter]);

  if (!user) return <PageSkeleton />;

  const total = items.reduce((sum, i) => sum + (i.price ?? 0), 0);
  // Current market where the repricing pass has answered, saved price elsewhere.
  const nowTotal = items.reduce((sum, i) => sum + (nowPrices[i.id] ?? i.price ?? 0), 0);
  // How many rows the repricing pass actually covers, for the cap disclosure.
  const repriceEligible = items.filter((i) => i.language === "en" && i.price != null).length;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      {/* 09-03 makeover (Chris): summary strip, one add panel that matches
          Search cards, tiles with a real price row (now vs saved) and the
          alert as a pill. Layout only — the data flow is unchanged. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-white">Watchlist</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cards you&apos;re hunting for — we track the market and email you when one dips.
          </p>
        </div>
        {items.length > 0 && (
          // Two numbers people can read (Chris, 09-03: "what does when
          // saved mean"): how many, and what they're worth now — with the
          // move since they were saved as a chip, only when there is one.
          <div className="flex items-center divide-x divide-white/10 overflow-hidden rounded-xl border border-edge bg-surface-1">
            <div className="px-4 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Watching</p>
              <p className="font-display text-lg font-semibold text-white">{items.length}</p>
            </div>
            <div className="px-4 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Total value</p>
              <p className="flex items-baseline gap-2">
                <span className="font-display text-lg font-semibold text-emerald-400">${nowTotal.toFixed(2)}</span>
                {Math.abs(nowTotal - total) >= 1 && (
                  <PriceDelta saved={total} now={nowTotal} />
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-surface-1 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <GameToggle game={game} onChange={setGame} compact />
          <p className="text-xs text-zinc-600">Add a card by name, or from a photo — no need to have it in hand.</p>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void handleImage(e.dataTransfer.files?.[0]);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={game === "mtg" ? "Name or number — e.g. Lightning Bolt LTR 187" : "Name or number — e.g. Charizard 4/102"}
            className="flex-1 rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSearch}
              disabled={busy !== null}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60 sm:flex-none"
            >
              {busy === "search" && <Spinner className="h-4 w-4" />}
              Search
            </button>
            {/* Doubles as the drop target on desktop (Chris, 09-01: no dashed zone). */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy === "identify"}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-4 py-2.5 text-sm font-medium transition disabled:opacity-70 sm:flex-none ${
                dragActive
                  ? "border-brand-300 bg-brand-500/20 text-white"
                  : "border-edge text-zinc-200 hover:border-edge-strong"
              }`}
            >
              {busy === "identify" ? (
                <>
                  <Spinner className="h-4 w-4" /> Identifying…
                </>
              ) : (
                "From a photo"
              )}
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {addError && <p className="text-xs text-red-400">{addError}</p>}

        {results.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">
                <span className="font-medium text-zinc-200">
                  {results.length} result{results.length === 1 ? "" : "s"}
                </span>
                <span className="text-zinc-600"> · tap one to add it</span>
              </p>
              <button
                onClick={() => {
                  setResults([]);
                  setAddError(null);
                  setQuery("");
                }}
                className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white"
              >
                ✕ Clear
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {results.map((card) => {
                const added = addedIds.has(card.id);
                const price = pickPrice(card)?.market ?? null;
                return (
                  <button
                    key={card.id}
                    onClick={() => handleAdd(card)}
                    className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition ${
                      added
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-edge bg-black/20 hover:-translate-y-0.5 hover:border-edge-strong"
                    }`}
                  >
                    <CardImage
                      src={card.imageSmall}
                      alt={card.name}
                      className="aspect-[5/7] w-full rounded-lg"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-xs font-medium text-white">{card.name}</span>
                      <span className="truncate text-[11px] text-zinc-500">
                        {card.setName} · {displayCardNumber(card)}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={`font-display text-sm font-semibold ${price != null ? "text-emerald-400" : "text-zinc-600"}`}>
                          {price != null ? `$${price.toFixed(2)}` : "—"}
                        </span>
                        <span className={`text-[11px] font-semibold ${added ? "text-emerald-400" : "text-brand-300"}`}>
                          {added ? "★ Saved" : "☆ Add"}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-edge bg-surface-1 p-3">
              <div className="aspect-[5/7] w-full rounded-lg bg-white/5" />
              <div className="h-3 w-3/4 rounded bg-white/5" />
              <div className="h-3 w-1/2 rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-edge-strong bg-surface-1 py-16 text-center">
          <div className="text-3xl">☆</div>
          <p className="text-sm font-medium text-white">
            Your watchlist is empty
          </p>
          <p className="max-w-xs text-xs text-zinc-500">
            Search for a card above or add one from a photo — no need to
            have it in hand.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Watching · {items.length}
              {listFilter.trim() && visibleItems.length !== items.length ? ` · showing ${visibleItems.length}` : ""}
            </h2>
            {items.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={listFilter}
                  onChange={(e) => setListFilter(e.target.value)}
                  placeholder="Filter your watchlist…"
                  className="w-44 rounded-lg border border-edge bg-black/40 px-3 py-1.5 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
                />
                <div className="relative">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as typeof sort)}
                    aria-label="Sort watchlist"
                    className="appearance-none rounded-lg border border-edge bg-black/40 py-1.5 pl-3 pr-7 text-xs text-zinc-200 outline-none transition focus:border-brand-400"
                  >
                    <option value="newest">Newest first</option>
                    <option value="name">Name A–Z</option>
                    <option value="price-high">Price: high to low</option>
                    <option value="price-low">Price: low to high</option>
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500">▾</span>
                </div>
              </div>
            )}
          </div>
          {visibleItems.length === 0 ? (
            <p className="rounded-xl border border-edge bg-surface-1 px-4 py-6 text-center text-sm text-zinc-500">
              Nothing matches that filter.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {visibleItems.map((item) => {
                const now = nowPrices[item.id];
                const shownPrice = now ?? item.price;
                return (
                  <div
                    key={item.id}
                    className="group relative flex flex-col gap-2.5 rounded-xl border border-edge bg-surface-1 p-3"
                  >
                    <button
                      onClick={() => handleRemove(item.id)}
                      aria-label={`Remove ${item.cardName} from watchlist`}
                      className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-zinc-400 transition hover:bg-black/80 hover:text-white focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                    >
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
                      </svg>
                    </button>

                    <button
                      onClick={() => void openDetail(item)}
                      title={`Open ${item.cardName}`}
                      className="relative w-full rounded-lg transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
                    >
                      <CardImage
                        src={item.imageUrl}
                        alt={item.cardName}
                        className="aspect-[5/7] w-full rounded-lg"
                      />
                      {item.alertPrice != null && (
                        <span className="absolute left-2 top-2 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-semibold text-black shadow">
                          🔔 ${item.alertPrice.toFixed(2)}
                        </span>
                      )}
                      {detailOpeningId === item.id && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
                          <Spinner className="h-5 w-5" />
                        </span>
                      )}
                    </button>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{item.cardName}</p>
                      {item.englishName && (
                        <p className="truncate text-xs font-medium text-brand-300">{item.englishName}</p>
                      )}
                      <p className="truncate text-xs text-zinc-500">
                        {item.setName} · {item.cardNumber}
                        {item.language !== "en" ? ` · ${LANGUAGE_LABEL[item.language]}` : ""}
                      </p>
                    </div>

                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`font-display text-lg font-semibold leading-tight ${shownPrice != null ? "text-emerald-400" : "text-zinc-600"}`}>
                          {shownPrice != null ? `$${shownPrice.toFixed(2)}` : "—"}
                        </p>
                        <p className="text-[11px] text-zinc-600">
                          {now != null && item.price != null
                            ? `saved at $${item.price.toFixed(2)} · ${formatDate(item.addedAt)}`
                            : `saved ${formatDate(item.addedAt)}`}
                        </p>
                      </div>
                      {item.price != null && now != null && <PriceDelta saved={item.price} now={now} />}
                    </div>

                    {(item.cardId ?? resolvedIds[item.id]) && (
                      <PriceSparkline cardId={(item.cardId ?? resolvedIds[item.id])!} />
                    )}
                    {item.cardId && (
                      <div className="flex justify-start">
                        <AlertControl
                          item={item}
                          onSaved={(saved) =>
                            setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)))
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {repriceEligible > REPRICE_LIMIT && (
            <p className="text-xs text-zinc-600">
              Live &quot;Now&quot; prices refresh for the first {REPRICE_LIMIT} cards you saved —
              the rest show their saved price (tap a card for its current market).
            </p>
          )}
        </>
      )}

      {detail && (() => {
        // Live row from state, so an alert set in the modal shows on the tile
        // (and in a reopened modal) without a refetch.
        const detailItem = items.find((i) => i.id === detail.itemId);
        return (
          <CardDetailModal
            card={detail.card}
            language={detail.language}
            logging={false}
            loading={detail.loading}
            onWatchlist
            watchlistControls={
              detailItem?.cardId ? (
                <AlertControl
                  item={detailItem}
                  onSaved={(saved) =>
                    setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)))
                  }
                />
              ) : null
            }
            onClose={() => setDetail(null)}
          />
        );
      })()}
    </main>
  );
}
