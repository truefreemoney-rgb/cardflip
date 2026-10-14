"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CardImage from "@/components/CardImage";
import CardTile from "@/components/CardTile";
import BuyOnEbayLink from "@/components/BuyOnEbayLink";
import { CardSearchBox, CardSearchResults, useCardSearch } from "@/components/CardSearch";
import CardDetailModal from "@/components/CardDetailModal";
import PageSkeleton from "@/components/PageSkeleton";
import Price from "@/components/Price";
import { PriceFlagText } from "@/components/PriceFlagNote";
import { useSession } from "@/components/SessionProvider";
import { toast } from "@/components/Toaster";
import { fetchCardById, fetchSets } from "@/lib/cards";
import { displayCardNumber } from "@/lib/games";
import { pickPrice, priceFlagOf } from "@/lib/listing";
import { logPriceCheck } from "@/lib/client/priceChecksApi";
import { addToWishlist, fetchWishlist, removeFromWishlist, type WishlistItem } from "@/lib/client/wishlistApi";
import type { SetInfo } from "@/lib/grading";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

/** Watchlist cards whose live price the empty-state row looks up (one catalog read each). */
const WATCH_ROW = 8;
/** Newest sets offered as tiles before anything is typed. */
const SET_TILES = 6;

/**
 * Search cards. 10-14 redesign (Chris: "it needs to look really good"; mockups A-F): the box is pinned under the
 * header, the intro text is gone, results are compact rows on a phone (or a grid) with Watch and Buy on each,
 * one Sort & filter sheet replaces the chip row, and the opened card keeps Buy on eBay and Watch in a bar at the
 * bottom. Before anything is typed: My Watchlist (Chris: recent lookups should be the watchlist) and the newest
 * sets. The search itself is shared with the Watchlist (components/CardSearch).
 */
export default function PriceCheckPage() {
  const { user } = useSession();

  // English-only for now — the ja/zh pipeline underneath still works.
  const language: ScanLanguage = "en";
  const [selected, setSelected] = useState<PokemonCard | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [logging, setLogging] = useState(false);
  const search = useCardSearch(language, () => setSelected(null));
  const { game } = search;

  // The watchlist: the empty-state row and every result's star.
  const [watch, setWatch] = useState<WishlistItem[] | null>(null);
  const [busyWatch, setBusyWatch] = useState<Set<string>>(new Set());
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    fetchWishlist()
      .then(setWatch)
      .catch(() => setWatch([]));
  }, [userId]);
  const watchedById = useMemo(() => {
    const m = new Map<string, WishlistItem>();
    for (const item of watch ?? []) if (item.cardId) m.set(item.cardId, item);
    return m;
  }, [watch]);

  async function selectCard(card: PokemonCard) {
    setSelected(card);
    setSelectedLoading(false);
    setLogging(true);
    // Lookups still land in the history (admin analytics); the page no longer lists them.
    await logPriceCheck(card, language);
    setLogging(false);
  }

  /** A watched card tapped before its catalog row landed: open on what the row knows, then the real card. */
  async function openStub(stub: PokemonCard) {
    setSelected(stub);
    setSelectedLoading(true);
    const card = stub.id ? await fetchCardById(stub.id, stub.game ?? game).catch(() => null) : null;
    if (card) await selectCard(card);
    else setSelectedLoading(false);
  }

  async function toggleWatch(card: PokemonCard) {
    if (!card.id || busyWatch.has(card.id)) return;
    setBusyWatch((s) => new Set(s).add(card.id));
    const done = () =>
      setBusyWatch((s) => {
        const next = new Set(s);
        next.delete(card.id);
        return next;
      });
    const existing = watchedById.get(card.id);
    if (existing) {
      setWatch((w) => (w ?? []).filter((i) => i.id !== existing.id));
      const ok = await removeFromWishlist(existing.id);
      if (ok) toast(`${card.name} removed from your watchlist`);
      else {
        setWatch((w) => [existing, ...(w ?? [])]);
        toast(`Couldn't remove ${card.name} — try again`, "err");
      }
      done();
      return;
    }
    // The price guard: a market the rule flags is not saved as the watchlist baseline.
    const picked = pickPrice(card);
    const item = await addToWishlist(card, language, picked?.untrusted ? null : (picked?.market ?? null));
    if (item) {
      setWatch((w) => [item, ...(w ?? [])]);
      toast(`${card.name} added to your watchlist`);
    } else toast("Couldn't save to watchlist — try again", "err");
    done();
  }

  if (!user) return <PageSkeleton />;

  const idle = search.results.length === 0 && !search.searching;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 pb-10 pt-1 sm:px-6 sm:pt-3">
      <h1 className="sr-only">Search cards</h1>
      <CardSearchBox search={search} sticky />

      {idle && (
        <>
          <WatchRow items={watch} game={game} onOpen={(card) => void selectCard(card)} onStub={(card) => void openStub(card)} />
          <SetTiles game={game} onPick={(set) => void search.browseSet(set.code ?? set.name, set.name)} onAll={() => search.setMode("browse")} />
        </>
      )}

      <CardSearchResults
        search={search}
        views
        footnote={
          <p className="mt-3 border-t border-white/5 pt-4 text-center text-[11px] leading-relaxed text-zinc-600">
            Prices update daily. CardFlip may earn a commission when you buy through eBay links.
          </p>
        }
      >
        {(cards, view) =>
          view === "list" ? (
            <ul className="-mx-1 divide-y divide-white/[0.06]">
              {cards.map((card) => (
                <ResultRow
                  key={card.id}
                  card={card}
                  browse={search.mode === "browse"}
                  watched={watchedById.has(card.id)}
                  watchBusy={busyWatch.has(card.id)}
                  onWatch={() => void toggleWatch(card)}
                  onOpen={() => void selectCard(card)}
                />
              ))}
            </ul>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {cards.map((card) => {
                const price = pickPrice(card);
                const flagged = priceFlagOf(card) != null;
                return (
                  <CardTile
                    key={card.id}
                    imageUrl={card.imageSmall}
                    name={card.name}
                    englishName={card.englishName}
                    subtitle={search.mode === "browse" ? displayCardNumber(card) : `${card.setName} · ${displayCardNumber(card)}`}
                    price={flagged ? null : (price?.market ?? null)}
                    flagged={flagged}
                    selected={selected?.id === card.id}
                    onOpen={() => void selectCard(card)}
                    footer={
                      <div className="flex gap-2">
                        <WatchStar watched={watchedById.has(card.id)} busy={busyWatch.has(card.id)} name={card.name} onClick={() => void toggleWatch(card)} />
                        <BuyOnEbayLink card={card} customId="search" solid label="Buy" className="h-9 flex-1 rounded-xl text-sm" />
                      </div>
                    }
                  />
                );
              })}
            </div>
          )
        }
      </CardSearchResults>

      {selected && (
        <CardDetailModal
          card={selected}
          language={language}
          logging={logging}
          loading={selectedLoading}
          buy
          watched={watchedById.has(selected.id)}
          watchBusy={busyWatch.has(selected.id)}
          onToggleWatch={() => void toggleWatch(selected)}
          onClose={() => {
            setSelected(null);
            setSelectedLoading(false);
          }}
        />
      )}
    </main>
  );
}

function WatchStar({ watched, busy, name, onClick, className = "" }: { watched: boolean; busy: boolean; name: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={busy}
      aria-pressed={watched}
      aria-label={watched ? `Stop watching ${name}` : `Watch ${name}`}
      title={watched ? "On your watchlist" : "Add to watchlist"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-base transition disabled:opacity-60 ${
        watched ? "border-holo-gold/40 bg-holo-gold/10 text-holo-gold" : "border-edge text-zinc-400 hover:border-edge-strong hover:text-white"
      } ${className}`}
    >
      {watched ? "★" : "☆"}
    </button>
  );
}

/** Rarity chip colours: the holo spectrum for the chase tiers, plain for the rest. */
function rarityTone(rarity: string): string {
  const r = rarity.toLowerCase();
  if (r.includes("illustration") || r.includes("gold") || r.includes("hyper")) return "border-holo-gold/35 bg-holo-gold/[0.07] text-holo-gold";
  if (r.includes("secret") || r.includes("special") || r.includes("mythic")) return "border-holo-pink/40 bg-holo-pink/[0.07] text-holo-pink";
  if (r.includes("shiny") || r.includes("ultra") || r.includes("ex") || r.includes("vmax") || r.includes("double")) return "border-holo-violet/40 bg-holo-violet/[0.08] text-holo-violet";
  return "border-edge text-zinc-400";
}

/** One result on a phone (mockup B): picture, name, set · number, rarity, then price over Watch + Buy. */
function ResultRow({
  card,
  browse,
  watched,
  watchBusy,
  onWatch,
  onOpen,
}: {
  card: PokemonCard;
  browse: boolean;
  watched: boolean;
  watchBusy: boolean;
  onWatch: () => void;
  onOpen: () => void;
}) {
  const flagged = priceFlagOf(card) != null;
  const market = flagged ? null : (pickPrice(card)?.market ?? null);
  return (
    <li className="flex items-center gap-3 px-1 py-2.5">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition hover:opacity-90">
        <CardImage src={card.imageSmall} alt={card.name} className="aspect-[5/7] w-14 shrink-0 rounded-md shadow-lg shadow-black/50" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">{card.name}</span>
          {card.englishName && <span className="block truncate text-xs font-medium text-brand-300">{card.englishName}</span>}
          <span className="mt-0.5 block truncate text-[12.5px] text-zinc-400">{browse ? displayCardNumber(card) : `${card.setName} · ${displayCardNumber(card)}`}</span>
          {card.rarity && <span className={`mt-1.5 inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${rarityTone(card.rarity)}`}>{card.rarity}</span>}
        </span>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {flagged ? (
          <span className="block max-w-[7.5rem] text-right text-[11px] font-medium leading-snug"><PriceFlagText /></span>
        ) : (
          <span className={`font-display text-lg font-bold tracking-tight ${market != null ? "text-white" : "text-zinc-600"}`}>
            <Price usd={market} />
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <WatchStar watched={watched} busy={watchBusy} name={card.name} onClick={onWatch} />
          <BuyOnEbayLink card={card} customId="search" solid label="Buy" className="h-9 rounded-xl px-3 text-[13px]" />
        </span>
      </div>
    </li>
  );
}

/** My Watchlist (mockup A): the newest watched cards with today's price and the move since each was saved. */
function WatchRow({
  items,
  game,
  onOpen,
  onStub,
}: {
  items: WishlistItem[] | null;
  game: GameId;
  onOpen: (card: PokemonCard) => void;
  onStub: (card: PokemonCard) => void;
}) {
  const rows = useMemo(() => [...(items ?? [])].sort((a, b) => b.addedAt - a.addedAt), [items]);
  const head = rows.slice(0, WATCH_ROW);
  const [live, setLive] = useState<Record<string, PokemonCard | null>>({});
  // Rows already asked for, so a re-render never fetches the same card twice.
  const asked = useRef(new Set<string>());
  const ids = head.map((i) => i.id).join(",");
  useEffect(() => {
    const missing = head.filter((i) => !asked.current.has(i.id));
    if (missing.length === 0) return;
    for (const i of missing) asked.current.add(i.id);
    void Promise.all(
      missing.map(async (i) => [i.id, i.cardId ? await fetchCardById(i.cardId, i.game ?? "pokemon").catch(() => null) : null] as const),
    ).then((got) => setLive((prev) => ({ ...prev, ...Object.fromEntries(got) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids shown
  }, [ids]);

  if (items === null) return null;
  return (
    <section>
      <div className="mb-2.5 mt-1 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight text-white">My Watchlist</h2>
        {rows.length > 0 && (
          <Link href="/app/wishlist" className="text-sm font-medium text-brand-300 transition hover:text-brand-200">
            See all {rows.length}
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-surface-1 px-4 py-4 text-sm leading-relaxed text-zinc-400">
          Tap <span className="text-holo-gold">☆</span> on any card to watch its price. Your watched cards show up here.
        </p>
      ) : (
        <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {head.map((item) => {
            const card = live[item.id];
            const flagged = card ? priceFlagOf(card) != null : false;
            const now = card && !flagged ? (pickPrice(card)?.market ?? null) : null;
            const move = now != null && item.price ? (now - item.price) / item.price : null;
            const stub: PokemonCard = {
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
              game: item.game ?? game,
            };
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => (card ? onOpen(card) : onStub(stub))}
                className="relative w-[118px] shrink-0 rounded-2xl border border-edge bg-surface-1 p-1.5 pb-2 text-left transition hover:border-edge-strong"
              >
                <CardImage src={item.imageUrl} alt={item.cardName} className="aspect-[5/7] w-full rounded-lg" />
                {item.alertPrice != null && (
                  <span className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-holo-gold">
                    🔔 <Price usd={item.alertPrice} />
                  </span>
                )}
                <span className="mt-1.5 block truncate px-0.5 text-[12.5px] font-semibold text-white">{item.cardName}</span>
                <span className="flex items-baseline justify-between gap-1 px-0.5">
                  <span className="font-display text-[15px] font-bold text-white">{card === undefined ? "…" : <Price usd={now} />}</span>
                  {move != null && Math.abs(move) >= 0.001 && (
                    <span className={`text-[11px] font-semibold ${move > 0 ? "text-emerald-400" : "text-red-400"}`} title="Since you saved it">
                      {move > 0 ? "▲" : "▼"} {(Math.abs(move) * 100).toFixed(1)}%
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * A set's picture (Chris 10-14: "images for all the sets, all games"): the Pokémon logo when TCGdex has one that
 * loads, otherwise the set's most valuable card, cropped to its art, from our own stored pictures.
 */
function SetArt({ set, game }: { set: SetInfo; game: GameId }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = game === "pokemon" && set.logoUrl && !logoFailed ? set.logoUrl : "";
  if (logo) {
    return (
      <span className="flex h-full items-center justify-center bg-[radial-gradient(120%_100%_at_50%_0%,rgba(170,180,255,0.16),transparent_70%)] px-3 py-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote set logos, any size */}
        <img src={logo} alt="" loading="lazy" onError={() => setLogoFailed(true)} className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]" />
      </span>
    );
  }
  if (set.coverUrl) {
    return (
      <span className="relative block h-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- our own card tile, cropped to the art */}
        <img src={set.coverUrl} alt="" loading="lazy" className="h-full w-full scale-110 object-cover object-[50%_28%]" />
        <span className="absolute inset-0 bg-gradient-to-t from-[#14161f] via-transparent to-transparent" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex h-full items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-9 w-9 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <rect x="7" y="3.5" width="11" height="15" rx="1.8" />
        <path d="M5 6.5v12.2c0 1 .8 1.8 1.8 1.8H15" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * The six sets offered before anything is typed: the newest released (real sets, 20+ cards), or, for a game whose
 * catalogue carries no release dates (One Piece), the six whose top card is worth the most.
 */
function pickSets(list: SetInfo[]): SetInfo[] {
  const today = new Date().toISOString().slice(0, 10);
  // A list served before covers existed (a cached copy) has no counts: every set qualifies then.
  const real = list.filter((s) => s.cards == null || s.cards >= 20);
  const dated = real.filter((s) => s.releaseDate && s.releaseDate <= today);
  if (dated.length >= SET_TILES) return [...dated].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).slice(0, SET_TILES);
  return [...real].sort((a, b) => (b.coverValue ?? 0) - (a.coverValue ?? 0)).slice(0, SET_TILES);
}

/** Open a whole set (mockup A): the newest released sets, one tap to every card in it. */
function SetTiles({ game, onPick, onAll }: { game: GameId; onPick: (set: SetInfo) => void; onAll: () => void }) {
  const [sets, setSets] = useState<{ game: GameId; list: SetInfo[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSets(game)
      .then((list) => {
        if (!cancelled) setSets({ game, list });
      })
      .catch(() => {
        if (!cancelled) setSets({ game, list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [game]);
  const newest = sets?.game === game ? pickSets(sets.list) : [];
  if (newest.length === 0) return null;
  return (
    <section>
      <div className="mb-2.5 mt-2 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight text-white">Open a whole set</h2>
        <button type="button" onClick={onAll} className="text-sm font-medium text-brand-300 transition hover:text-brand-200">
          All sets
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {newest.map((set) => (
          <button
            key={set.code ?? set.name}
            type="button"
            onClick={() => onPick(set)}
            className="flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface-1 text-left transition hover:border-edge-strong"
          >
            <span className="block h-[72px]">
              <SetArt set={set} game={game} />
            </span>
            <span className="min-w-0 px-3 pb-2.5 pt-1">
              <span className="block truncate text-[13px] font-semibold text-white">{set.name}</span>
              <span className="block text-[11.5px] text-zinc-500">{!set.releaseDate ? (set.cards ? `${set.cards.toLocaleString("en-US")} cards` : "") : new Date(`${set.releaseDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/New_York" })}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
