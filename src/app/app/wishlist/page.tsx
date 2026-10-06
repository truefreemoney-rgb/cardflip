"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CardImage from "@/components/CardImage";
import CardDetailModal from "@/components/CardDetailModal";
import Spinner from "@/components/Spinner";
import { CardSearchBox, CardSearchResults, useCardSearch } from "@/components/CardSearch";
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
import { fetchCardById, searchCards } from "@/lib/cards";
import { ebaySearchUrl, ebaySoldSearchUrl, formatMoney, pickPrice, priceFlagOf, withEpnParams } from "@/lib/listing";
import { PriceFlagText, PriceStaleNote } from "@/components/PriceFlagNote";
import { PRICE_FLAG_LINK, priceFlagLeftOut, type PriceFlag, type PriceStale } from "@/lib/priceFlag";
import { normalizeNumber } from "@/lib/cardNumber";
import { displayCardNumber } from "@/lib/games";
import type { PokemonCard, ScanLanguage } from "@/lib/types";
import { etDate } from "@/lib/time";

const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
};

/** "Sep 8" this year, "Sep 8, 2025" otherwise — the tile has no room for more. Eastern day. */
function formatShortDate(ts: number): string {
  const thisYear = etDate(ts, "", { year: "numeric" }) === etDate(Date.now(), "", { year: "numeric" });
  return etDate(ts, "", { month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) });
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
    toast(target != null ? `Alert set — email at ${formatMoney(target)}` : "Alert removed");
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
      data-tour="alert"
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
      className={`w-full rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition ${
        item.alertPrice != null
          ? "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
          : "border-edge text-zinc-500 hover:border-edge-strong hover:text-zinc-300"
      }`}
    >
      {item.alertPrice != null
        ? `🔔 Alert at ${formatMoney(item.alertPrice)}${item.alertedAt ? " · sent" : ""}`
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
  /** item.id → the price guard flags today's market (no number, out of the totals). */
  flags: Record<string, PriceFlag>;
  /** item.id → today's market has not updated in 45+ days (10-02): the number shows, with a note under it. */
  stale: Record<string, PriceStale>;
}

/** eBay Partner Network campaign id (empty until the owner joins EPN: the Buy link is then a plain eBay link). */
const EPN_CAMPAIGN_ID = process.env.NEXT_PUBLIC_EBAY_EPN_CAMPAIGN_ID ?? "";

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
    // Rows saved without a price still get today's number (09-08).
    .filter((item) => item.language === "en")
    .slice(0, REPRICE_LIMIT);

  const prices: Record<string, number> = {};
  const cardIds: Record<string, string> = {};
  const resolved: Record<string, PokemonCard> = {};
  const flags: Record<string, PriceFlag> = {};
  const stale: Record<string, PriceStale> = {};
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
        if (usd?.untrusted) flags[item.id] = usd.untrusted;
        else if (usd?.market != null) {
          prices[item.id] = usd.market;
          // A market that has not updated in 45+ days (10-02): shown, with the note under it.
          if (usd.stale) stale[item.id] = usd.stale;
        }
      } catch {
        // Row keeps its saved price; delta and sparkline just don't show.
      }
    }),
  );
  return { prices, cardIds, cards: resolved, flags, stale };
}

/** Since-saved move as a chip; quiet when under a dollar and 1%. */
function PriceDelta({ saved, now }: { saved: number; now: number }) {
  const delta = now - saved;
  const pct = saved > 0 ? (delta / saved) * 100 : 0;
  if (Math.abs(delta) < 1 && Math.abs(pct) < 1) {
    return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-500">steady</span>;
  }
  const up = delta > 0;
  // Compact: direction + percent; the dollar move lives in the tooltip
  // (09-08 makeover — "▼ −$0.01 · 6%" wrapped inside the tile).
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
        up ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
      }`}
      title={`${up ? "Up" : "Down"} ${formatMoney(Math.abs(delta))} since you saved it at ${formatMoney(saved)}`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct) >= 10 ? Math.abs(pct).toFixed(0) : Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function WishlistPage() {
  const { user } = useSession();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  // The list couldn't load (offline, 5xx) — not the same as "empty".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowPrices, setNowPrices] = useState<Record<string, number>>({});
  // Rows whose current market the price guard flags: the note instead of a number, and out of the totals.
  const [nowFlags, setNowFlags] = useState<Record<string, PriceFlag>>({});
  const [nowStale, setNowStale] = useState<Record<string, PriceStale>>({});
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
  // The same search as Search Cards (components/CardSearch): game, By Name /
  // By Set, filter and sort. The "From a Photo" way in (a file picker and a
  // drop target) went 10-03 with every photo upload on the site.
  const [resultsLanguage, setResultsLanguage] = useState<ScanLanguage>("en");
  const search = useCardSearch(addLanguage, () => setResultsLanguage(addLanguage));
  const { game } = search;
  const [addError, setAddError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  // Catalog picture per row, for a row that saved none (10-02: a search answer older than the picture fill).
  const [catalogPictures, setCatalogPictures] = useState<Record<string, string>>({});

  const userId = user?.id;
  const [loadSeq, setLoadSeq] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchWishlist()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        // Deltas fill in as they arrive; the list never waits on pricing.
        fetchCurrentPrices(list)
          .then(({ prices, cardIds, cards, flags, stale }) => {
            if (cancelled) return;
            setNowPrices(prices);
            setNowFlags(flags);
            setNowStale(stale);
            setResolvedIds(cardIds);
            resolvedCards.current = { ...resolvedCards.current, ...cards };
            setCatalogPictures(Object.fromEntries(Object.entries(cards).map(([id, c]) => [id, c.imageSmall])));
          })
          .catch(() => {
            // Prices are decoration here; the list stands without them.
          });
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load your watchlist — check your connection.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, loadSeq]);

  // Remove is undoable (QA, 09-04: the DELETE used to fire on the tap). The
  // tile leaves at once; the server delete waits out the toast's Undo window
  // and is flushed if the page unmounts first, so nothing silently survives.
  const pendingRemovals = useRef(new Map<string, { item: WishlistItem; index: number; timer: ReturnType<typeof setTimeout> }>());
  const putBack = (index: number, item: WishlistItem) =>
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== item.id);
      next.splice(Math.min(index, next.length), 0, item);
      return next;
    });
  const finalizeRemoval = useCallback(async (id: string) => {
    const pending = pendingRemovals.current.get(id);
    if (!pending) return;
    pendingRemovals.current.delete(id);
    clearTimeout(pending.timer);
    const ok = await removeFromWishlist(id);
    if (!ok) {
      putBack(pending.index, pending.item);
      setAddError(`Couldn't remove ${pending.item.cardName ?? "that card"} — check your connection and try again.`);
    }
  }, []);
  useEffect(() => {
    const removals = pendingRemovals.current;
    return () => {
      for (const id of [...removals.keys()]) {
        const pending = removals.get(id)!;
        removals.delete(id);
        clearTimeout(pending.timer);
        void removeFromWishlist(id);
      }
    };
  }, []);
  function handleRemove(id: string) {
    const index = items.findIndex((i) => i.id === id);
    const item = items[index];
    if (!item) return;
    setAddError(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
    pendingRemovals.current.set(id, { item, index, timer: setTimeout(() => void finalizeRemoval(id), 5500) });
    toast(`Removed ${item.cardName ?? "card"} from your watchlist`, "info", {
      label: "Undo",
      onClick: () => {
        const pending = pendingRemovals.current.get(id);
        if (!pending) return;
        pendingRemovals.current.delete(id);
        clearTimeout(pending.timer);
        putBack(pending.index, pending.item);
      },
    });
  }

  /** The saved row for a catalog card, so a search tile knows it is already on the list (and can take it off). */
  const savedRowFor = (cardId: string) => items.find((i) => (i.cardId ?? resolvedIds[i.id]) === cardId) ?? null;

  async function handleAdd(card: PokemonCard) {
    // A second tap on a saved tile takes the card off again (Chris 10-02), with
    // the same Undo toast as the grid's remove.
    const saved = savedRowFor(card.id);
    if (saved) {
      setAddedIds((prev) => { const next = new Set(prev); next.delete(card.id); return next; });
      handleRemove(saved.id);
      return;
    }
    if (addedIds.has(card.id)) return;
    const price = priceFlagOf(card) ? null : (pickPrice(card)?.market ?? null);
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
    // Game tabs (09-30): the list shows only the selected game's cards, the
    // same split as Inventory. Items saved before games existed are Pokémon.
    const inGame = items.filter((i) => (i.game ?? "pokemon") === game);
    const filtered = q
      ? inGame.filter((i) =>
          `${i.cardName} ${i.englishName ?? ""} ${i.setName}`.toLowerCase().includes(q),
        )
      : inGame;
    const sorted = [...filtered];
    if (sort === "name") sorted.sort((a, b) => a.cardName.localeCompare(b.cardName));
    // A row the price guard flags sorts as unpriced.
    else if (sort === "price-high") sorted.sort((a, b) => (nowFlags[b.id] ? -1 : (b.price ?? -1)) - (nowFlags[a.id] ? -1 : (a.price ?? -1)));
    else if (sort === "price-low")
      sorted.sort((a, b) => (nowFlags[a.id] ? Infinity : (a.price ?? Infinity)) - (nowFlags[b.id] ? Infinity : (b.price ?? Infinity)));
    // "newest" keeps the server order (added desc, new saves prepended).
    return sorted;
  }, [items, sort, listFilter, game, nowFlags]);

  if (!user) return <PageSkeleton />;

  // A row the price guard flags counts for nothing: its saved and current numbers are both left out.
  const total = items.reduce((sum, i) => sum + (nowFlags[i.id] ? 0 : (i.price ?? 0)), 0);
  // Current market where the repricing pass has answered, saved price elsewhere.
  const nowTotal = items.reduce((sum, i) => sum + (nowFlags[i.id] ? 0 : (nowPrices[i.id] ?? i.price ?? 0)), 0);
  const flaggedCount = items.filter((i) => nowFlags[i.id]).length;
  // Dip alerts already armed — the one thing about the list the summary strip
  // could answer without scrolling it.
  const alertCount = items.filter((i) => i.alertPrice != null).length;
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
          // 09-09 makeover: the money leads in display type on the page's one
          // foil panel, armed alerts join it, and figures are tabular so the
          // total doesn't jitter as live prices land. On a phone the value
          // takes a full row instead of a squeezed third. Auto columns, not
          // three equal tracks — equal ones size every cell to the price and
          // push the whole strip off the header row.
          <dl className="foil-edge grid w-full grid-cols-2 rounded-2xl [--foil-fill:#0b0d13] sm:w-auto sm:grid-cols-[auto_auto_auto]">
            <div className="col-span-2 border-b border-white/10 px-4 py-3 sm:col-span-1 sm:border-b-0 sm:border-r sm:px-5">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Total value</dt>
              <dd className="mt-0.5 flex flex-wrap items-baseline gap-2">
                <span className="font-display text-2xl font-semibold tabular-nums tracking-tight text-emerald-400">
                  {formatMoney(nowTotal)}
                </span>
                {Math.abs(nowTotal - total) >= 1 && (
                  <PriceDelta saved={total} now={nowTotal} />
                )}
              </dd>
              {flaggedCount > 0 && <p className="mt-1 text-xs text-amber-300">{priceFlagLeftOut(flaggedCount)}</p>}
            </div>
            <div className="border-r border-white/10 px-4 py-3 sm:px-5">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Watching</dt>
              <dd className="mt-0.5 font-display text-2xl font-semibold tabular-nums tracking-tight text-white">
                {items.length}
              </dd>
            </div>
            <div
              className="px-4 py-3 sm:px-5"
              title="Cards with a dip alert set — we email you when the market reaches your price"
            >
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Alerts</dt>
              <dd
                className={`mt-0.5 font-display text-2xl font-semibold tabular-nums tracking-tight ${
                  alertCount > 0 ? "text-white" : "text-zinc-600"
                }`}
              >
                {alertCount}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-surface-1 p-5">
        <CardSearchBox
          search={search}
          hint={search.mode === "browse" ? "Every card in the set — tap any to watch it." : "Add a card by name — no need to have it in hand."}
        />

        {addError && <p className="text-xs text-red-400">{addError}</p>}

        <CardSearchResults search={search} hint="tap one to add it, tap again to remove it">
          {(shown) => (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {shown.map((card) => {
                const added = addedIds.has(card.id) || savedRowFor(card.id) != null;
                const flagged = priceFlagOf(card) != null;
                const price = flagged ? null : (pickPrice(card)?.market ?? null);
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
                        {flagged ? (
                          <span className="text-[11px] font-medium leading-snug"><PriceFlagText /></span>
                        ) : (
                          <span className={`font-display text-sm font-semibold ${price != null ? "text-emerald-400" : "text-zinc-600"}`}>
                            {formatMoney(price)}
                          </span>
                        )}
                        <span className={`text-[11px] font-semibold ${added ? "text-emerald-400" : "text-brand-300"}`}>
                          {added ? "★ Saved" : "☆ Add"}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </CardSearchResults>
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
      ) : loadError && items.length === 0 ? (
        <p
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              setLoadSeq((n) => n + 1);
            }}
            className="rounded-full border border-red-400/40 px-3 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
          >
            Retry
          </button>
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-edge-strong bg-surface-1 py-16 text-center">
          <div className="text-3xl">☆</div>
          <p className="text-sm font-medium text-white">
            Your watchlist is empty
          </p>
          <p className="max-w-xs text-xs text-zinc-500">
            Search for a card above — no need to have it in hand.
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
                const flagged = Boolean(nowFlags[item.id]);
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
                        src={item.imageUrl || catalogPictures[item.id] || ""}
                        alt={item.cardName}
                        className="aspect-[5/7] w-full rounded-lg"
                      />
                      {item.alertPrice != null && (
                        <span className="absolute left-2 top-2 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-semibold text-black shadow">
                          🔔 {formatMoney(item.alertPrice)}
                        </span>
                      )}
                      {detailOpeningId === item.id && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
                          <Spinner className="h-5 w-5" />
                        </span>
                      )}
                    </button>

                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-snug text-white [overflow-wrap:anywhere]">{item.cardName}</p>
                      {item.englishName && (
                        <p className="truncate text-xs font-medium text-brand-300">{item.englishName}</p>
                      )}
                      <p className="truncate text-xs text-zinc-500">
                        {item.setName} · {item.cardNumber}
                        {item.language !== "en" ? ` · ${LANGUAGE_LABEL[item.language]}` : ""}
                      </p>
                    </div>

                    {/* Tile foot (09-08 makeover): price with the since-saved
                        move beside it, ONE muted line for the save, the
                        sparkline across the full width, then the alert. */}
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        {flagged ? (
                          // The note says "check sold listings": the tile hands over that search (10-02), as the Inventory and the detail view do.
                          <p className="text-xs font-medium leading-snug">
                            <PriceFlagText />.{" "}
                            <a
                              href={ebaySoldSearchUrl(stubCard(item))}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="whitespace-nowrap font-semibold text-amber-300 underline underline-offset-2 transition hover:text-amber-200"
                            >
                              {PRICE_FLAG_LINK}
                            </a>
                          </p>
                        ) : (
                          <p className={`font-display text-xl font-semibold leading-none tabular-nums ${shownPrice != null ? "text-emerald-400" : "text-zinc-600"}`}>
                            {formatMoney(shownPrice)}
                          </p>
                        )}
                        {!flagged && item.price != null && now != null && <PriceDelta saved={item.price} now={now} />}
                      </div>
                      {!flagged && nowStale[item.id] && <PriceStaleNote className="mt-1" days={nowStale[item.id].days} soldUrl={ebaySoldSearchUrl(stubCard(item))} />}
                      <p className="mt-1 truncate text-[11px] text-zinc-500">
                        {!flagged && now != null && item.price != null
                          ? `Saved ${formatMoney(item.price)} · ${formatShortDate(item.addedAt)}`
                          : `Saved ${formatShortDate(item.addedAt)}`}
                      </p>
                    </div>

                    <a
                      href={withEpnParams(ebaySearchUrl(stubCard(item), {}, { sort: "lowest" }), EPN_CAMPAIGN_ID, "wishlist")}
                      target="_blank"
                      rel={EPN_CAMPAIGN_ID ? "noopener noreferrer sponsored" : "noopener noreferrer"}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-center text-xs font-semibold text-brand-300 transition hover:bg-brand-500/20"
                    >
                      Buy on eBay
                    </a>

                    {(item.cardId ?? resolvedIds[item.id]) && (
                      <PriceSparkline cardId={(item.cardId ?? resolvedIds[item.id])!} stretch />
                    )}
                    {item.cardId && (
                      <div className="mt-auto">
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
