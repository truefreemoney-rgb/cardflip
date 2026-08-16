"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import CardImage from "@/components/CardImage";
import AppTabs from "@/components/AppTabs";
import Spinner from "@/components/Spinner";
import GameToggle from "@/components/GameToggle";
import { fetchCurrentUser, type SessionUser } from "@/lib/client/auth";
import {
  addToWishlist,
  fetchWishlist,
  removeFromWishlist,
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
 * Wishlist items freeze the price at the moment they were saved, which is what
 * makes them useful as a watch list: re-pricing them on load turns each one
 * into "what it was then vs what it is now". English-only because that's the
 * only catalogue with market pricing attached.
 */
const REPRICE_LIMIT = 15;

async function fetchCurrentPrices(
  items: WishlistItem[],
): Promise<Record<string, number>> {
  const targets = items
    .filter((item) => item.language === "en" && item.price != null)
    .slice(0, REPRICE_LIMIT);

  const entries = await Promise.all(
    targets.map(async (item): Promise<[string, number] | null> => {
      try {
        const cards = await searchCards(item.cardName, item.cardNumber || null, "en");
        const match =
          cards.find(
            (c) =>
              c.name === item.cardName &&
              (!item.cardNumber ||
                normalizeNumber(c.number) === normalizeNumber(item.cardNumber)),
          ) ?? cards[0];
        const usd = match?.prices.find(
          (p) => p.currency === "USD" && p.market != null,
        );
        return usd?.market != null ? [item.id, usd.market] : null;
      } catch {
        return null;
      }
    }),
  );

  return Object.fromEntries(
    entries.filter((e): e is [string, number] => e !== null),
  );
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
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowPrices, setNowPrices] = useState<Record<string, number>>({});

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

  useEffect(() => {
    fetchCurrentUser().then((current) => {
      if (!current) {
        router.replace("/signup");
        return;
      }
      setUser(current);
      setCheckedAuth(true);
    });
    fetchWishlist()
      .then((list) => {
        setItems(list);
        // Deltas fill in as they arrive; the list never waits on pricing.
        void fetchCurrentPrices(list).then(setNowPrices);
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleRemove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await removeFromWishlist(id);
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
    if (!item) return;
    setAddedIds((prev) => new Set(prev).add(card.id));
    // The server no-ops on duplicates and returns the existing row, so only
    // prepend when it isn't already in the grid.
    setItems((prev) =>
      prev.some((i) => i.id === item.id) ? prev : [item, ...prev],
    );
  }

  if (!checkedAuth || !user) return null;

  const total = items.reduce((sum, i) => sum + (i.price ?? 0), 0);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 bg-background/85 px-4 py-3 backdrop-blur-md after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-holo-violet/25 after:to-transparent sm:px-6">
        <Logo size="sm" />
        <AppTabs />
        <span className="hidden text-sm text-zinc-400 sm:inline">
          {user.name}
        </span>
      </header>

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
          <p className="text-sm text-zinc-500">Loading…</p>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {items.map((item) => (
              <div
                key={item.id}
                className="group relative flex flex-col items-center gap-2 rounded-xl border border-edge bg-surface-1 p-3"
              >
                <button
                  onClick={() => handleRemove(item.id)}
                  aria-label={`Remove ${item.cardName} from wishlist`}
                  className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-zinc-400 opacity-0 transition hover:bg-black/80 hover:text-white group-hover:opacity-100"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
                  </svg>
                </button>

                <CardImage
                  src={item.imageUrl}
                  alt={item.cardName}
                  className="aspect-[5/7] w-full rounded-lg"
                />
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
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
