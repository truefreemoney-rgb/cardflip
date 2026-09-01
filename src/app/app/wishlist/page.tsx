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
import { searchCards } from "@/lib/cards";
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
        }}
        className="flex items-center gap-1"
      >
        <span className="text-[11px] text-zinc-500">$</span>
        <input
          autoFocus
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={item.price != null ? item.price.toFixed(2) : "0.00"}
          className="w-16 rounded-md border border-edge bg-black/40 px-1.5 py-1 text-center text-xs text-white outline-none focus:border-brand-400"
          aria-label={`Alert price for ${item.cardName}`}
        />
        <button type="submit" disabled={busy} className="rounded-full bg-brand-500/15 px-2 py-1 text-[11px] font-medium text-brand-300 hover:bg-brand-500/25 disabled:opacity-50">
          Set
        </button>
        {item.alertPrice != null && (
          <button type="button" disabled={busy} onClick={() => void save(null)} className="px-1 text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-300">
            Clear
          </button>
        )}
      </form>
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className="text-[11px] text-zinc-500 underline underline-offset-2 transition hover:text-zinc-300"
    >
      {item.alertPrice != null
        ? `🔔 alert at $${item.alertPrice.toFixed(2)}${item.alertedAt ? " · sent" : ""}`
        : "🔔 price alert"}
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
}

/** Find the catalog card behind a saved row — the same match walk the
 * repricing pass uses (id first, then exact name+number, then top hit). */
async function resolveWishlistCard(item: WishlistItem): Promise<PokemonCard | null> {
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
        if (!item.cardId && match.id) cardIds[item.id] = match.id;
        const usd = match.prices.find((p) => p.currency === "USD" && p.market != null);
        if (usd?.market != null) prices[item.id] = usd.market;
      } catch {
        // Row keeps its saved price; delta and sparkline just don't show.
      }
    }),
  );
  return { prices, cardIds };
}

/** "Then vs now" for a saved card; quiet when the move is under a dollar and 1%. */
function PriceDelta({ saved, now }: { saved: number; now: number }) {
  const delta = now - saved;
  const pct = saved > 0 ? (delta / saved) * 100 : 0;

  if (Math.abs(delta) < 1 && Math.abs(pct) < 1) {
    return (
      <span className="text-[11px] text-zinc-500">
        Now ${now.toFixed(2)} · steady
      </span>
    );
  }

  const up = delta > 0;
  return (
    <span
      className={`text-[11px] font-medium ${up ? "text-emerald-400" : "text-red-400"}`}
    >
      Now ${now.toFixed(2)} · {up ? "▲" : "▼"} {up ? "+" : "−"}$
      {Math.abs(delta).toFixed(2)} ({pct > 0 ? "+" : ""}
      {pct.toFixed(0)}%)
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
  const [detail, setDetail] = useState<{ card: PokemonCard; language: ScanLanguage } | null>(null);
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
        void fetchCurrentPrices(list).then(({ prices, cardIds }) => {
          if (cancelled) return;
          setNowPrices(prices);
          setResolvedIds(cardIds);
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
    toast(`${card.name} added to your wishlist`);
    // The server no-ops on duplicates and returns the existing row, so only
    // prepend when it isn't already in the grid.
    setItems((prev) =>
      prev.some((i) => i.id === item.id) ? prev : [item, ...prev],
    );
  }

  async function openDetail(item: WishlistItem) {
    if (detailOpeningId) return;
    setDetailOpeningId(item.id);
    setAddError(null);
    try {
      const card = await resolveWishlistCard(item);
      if (card) {
        setDetail({ card, language: item.language });
      } else {
        setAddError(`Couldn't find ${item.cardName} in the catalog right now — try again in a moment.`);
      }
    } catch {
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
  // How many rows the repricing pass actually covers, for the cap disclosure.
  const repriceEligible = items.filter((i) => i.language === "en" && i.price != null).length;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Wishlist</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cards you&apos;re hunting for — search the database or drop a
            picture to add one.
          </p>
        </div>
        {items.length > 0 && (
          <div className="text-right">
            <p className="text-lg font-semibold text-emerald-400">
              ${total.toFixed(2)}
            </p>
            <p className="text-xs text-zinc-500">
              {items.length} card{items.length === 1 ? "" : "s"} saved
            </p>
          </div>
        )}
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
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
          >
            {busy === "search" && <Spinner className="h-4 w-4" />}
            Search
          </button>
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
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm transition ${
            dragActive
              ? "border-brand-400 bg-brand-500/10 text-brand-300"
              : "border-edge-strong text-zinc-500 hover:border-brand-400/50 hover:text-zinc-400"
          }`}
        >
          {busy === "identify" ? (
            <>
              <Spinner className="h-4 w-4" /> Identifying…
            </>
          ) : (
            <>Drop a picture of the card here — or click to browse</>
          )}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {results.map((card) => {
              const added = addedIds.has(card.id);
              return (
                <button
                  key={card.id}
                  onClick={() => handleAdd(card)}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-left transition ${
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
                  <span className="w-full truncate text-center text-xs font-medium text-white">
                    {card.name}
                  </span>
                  <span className="w-full truncate text-center text-[11px] text-zinc-500">
                    {card.setName} · {displayCardNumber(card)}
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      added ? "text-emerald-400" : "text-brand-300"
                    }`}
                  >
                    {added ? "★ On wishlist" : "☆ Add to wishlist"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-edge bg-surface-1 p-3">
              <div className="aspect-[5/7] w-full rounded-lg bg-white/5" />
              <div className="h-3 w-3/4 self-center rounded bg-white/5" />
              <div className="h-3 w-1/2 self-center rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-edge-strong bg-surface-1 py-16 text-center">
          <div className="text-3xl">☆</div>
          <p className="text-sm font-medium text-white">
            Your wishlist is empty
          </p>
          <p className="max-w-xs text-xs text-zinc-500">
            Search for a card above or drop a picture of one — no need to
            have it in hand.
          </p>
        </div>
      ) : (
        <>
          {items.length > 1 && (
            <div className="-mb-3 flex flex-wrap items-center gap-2">
              <input
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder="Filter your wishlist…"
                className="rounded-lg border border-edge bg-black/40 px-3 py-1.5 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label="Sort wishlist"
                className="rounded-lg border border-edge bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none transition focus:border-brand-400"
              >
                <option value="newest">Newest first</option>
                <option value="name">Name A–Z</option>
                <option value="price-high">Price: high to low</option>
                <option value="price-low">Price: low to high</option>
              </select>
            </div>
          )}
          {visibleItems.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing matches that filter.</p>
          ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {visibleItems.map((item) => (
            <div
              key={item.id}
              className="group relative flex flex-col items-center gap-2 rounded-xl border border-edge bg-surface-1 p-3"
            >
              <button
                onClick={() => handleRemove(item.id)}
                aria-label={`Remove ${item.cardName} from wishlist`}
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
                {detailOpeningId === item.id && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
                    <Spinner className="h-5 w-5" />
                  </span>
                )}
              </button>
              <span className="w-full truncate text-center text-xs font-medium text-white">
                {item.cardName}
              </span>
              {item.englishName && (
                <span className="w-full truncate text-center text-[11px] font-medium text-brand-300">
                  {item.englishName}
                </span>
              )}
              <span className="w-full truncate text-center text-[11px] text-zinc-500">
                {item.setName} · {item.cardNumber}
              </span>
              <span className="w-full truncate text-center text-[10px] text-zinc-600">
                {LANGUAGE_LABEL[item.language]} · {formatDate(item.addedAt)}
              </span>
              {item.price != null && (
                <span className="text-sm font-semibold text-emerald-400">
                  ${item.price.toFixed(2)}
                  <span className="ml-1 text-[10px] font-normal text-zinc-600">
                    saved
                  </span>
                </span>
              )}
              {item.price != null && nowPrices[item.id] != null && (
                <PriceDelta saved={item.price} now={nowPrices[item.id]} />
              )}
              {(item.cardId ?? resolvedIds[item.id]) && (
                <PriceSparkline cardId={(item.cardId ?? resolvedIds[item.id])!} className="mt-0.5" />
              )}
              {item.cardId && (
                <AlertControl
                  item={item}
                  onSaved={(saved) =>
                    setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)))
                  }
                />
              )}
            </div>
          ))}
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

      {detail && (
        <CardDetailModal
          card={detail.card}
          language={detail.language}
          logging={false}
          onClose={() => setDetail(null)}
        />
      )}
    </main>
  );
}
