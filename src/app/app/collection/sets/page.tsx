"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ArtImg from "@/components/ArtImg";
import GameToggle from "@/components/GameToggle";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import { toast } from "@/components/Toaster";
import { apiPath } from "@/lib/client/basePath";
import { fetchWishlist } from "@/lib/client/wishlistApi";
import { GAMES, isGameId, readSavedGame, saveGame } from "@/lib/games";
import { formatMoney } from "@/lib/listing";
import type { GameId } from "@/lib/types";

/**
 * Set completion (09-27): every set you own a card from, how far along it
 * is, what finishing it costs today, and the cheapest cards to get there.
 * Tap a set for the full missing list; Watch puts a card on the watchlist.
 * Every game (10-06): ?game=mtg opens that game, else the game the Inventory
 * and scanner remember (cardflip.game); the toggle switches and remembers.
 */

function startGame(): GameId {
  if (typeof window === "undefined") return "pokemon";
  const q = new URLSearchParams(window.location.search).get("game");
  return isGameId(q) ? q : readSavedGame();
}

interface MissingCard {
  id: string;
  name: string;
  number: string;
  label: string;
  imageUrl: string;
  price: number | null;
}

interface SetProgress {
  setId: string;
  setName: string;
  releaseDate: string | null;
  owned: number;
  total: number;
  printed: number | null;
  pct: number;
  missing: number;
  costToFinish: number;
  unpriced: number;
  cheapest: MissingCard[];
}

export default function SetCompletionPage() {
  const { status } = useSession();
  const [game, setGame] = useState<GameId>(startGame);
  const [setsBy, setSetsBy] = useState<Partial<Record<GameId, SetProgress[]>>>({});
  const sets = setsBy[game] ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, MissingCard[] | "loading">>({});
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    void fetch(apiPath(`/api/cards/sets?game=${game}`), { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        if (live) setSetsBy((m) => ({ ...m, [game]: j.sets ?? [] }));
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [status, tick, game]);

  function switchGame(next: GameId) {
    if (next === game) return;
    saveGame(next);
    setGame(next);
    setOpen(null);
    setFailed(false);
  }

  // Cards already on the watchlist show as watched. Best effort: if it
  // fails the buttons just read "Watch".
  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    void fetchWishlist()
      .then((items) => {
        if (live) setWatched(new Set(items.map((i) => i.cardId).filter((id): id is string => Boolean(id))));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [status]);

  async function showAll(setId: string) {
    const key = `${game}:${setId}`;
    if (full[key]) return;
    setFull((f) => ({ ...f, [key]: "loading" }));
    try {
      const r = await fetch(apiPath(`/api/cards/sets?game=${game}&set=${encodeURIComponent(setId)}`), { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setFull((f) => ({ ...f, [key]: j.missing ?? [] }));
    } catch {
      // Drop the entry (don't cache []) so Show all can be tapped again.
      setFull((f) => {
        const next = { ...f };
        delete next[key];
        return next;
      });
      toast("Couldn't load the missing list — try again", "err");
    }
  }

  async function watch(set: SetProgress, card: MissingCard) {
    try {
      const r = await fetch(apiPath("/api/wishlist"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          card: {
            id: card.id,
            name: card.name,
            setName: set.setName,
            setSeries: "",
            number: card.number,
            rarity: null,
            imageSmall: card.imageUrl,
            // Only Pokémon art has a /high.webp twin; the other games keep their one picture.
            imageLarge: game === "pokemon" ? card.imageUrl.replace("/low.webp", "/high.webp") : card.imageUrl,
            prices: [],
            englishName: null,
            game,
            setTotal: game === "pokemon" ? set.printed : null,
            setCode: null,
            isSecretRare: false,
          },
          language: "en",
          price: card.price,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setWatched((w) => new Set(w).add(card.id));
      toast(`${card.name} added to your watchlist`);
    } catch {
      toast("Couldn't add it to the watchlist — try again", "err");
    }
  }

  if (failed && !sets && status === "ready") {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-3 px-4 py-16 text-center">
        <h1 className="font-display text-xl font-semibold text-white">Couldn&apos;t load your sets</h1>
        <p className="text-sm text-zinc-400">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setTick((n) => n + 1);
          }}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
        >
          Retry
        </button>
      </main>
    );
  }
  if (status !== "ready") return <PageSkeleton />;

  const Card = ({ set, card }: { set: SetProgress; card: MissingCard }) => (
    <li className="flex items-center gap-3 py-2">
      {card.imageUrl ? (
        <ArtImg src={card.imageUrl} alt="" width={36} height={48} className="h-12 w-9 shrink-0 rounded object-cover" loading="lazy" />
      ) : (
        <span className="h-12 w-9 shrink-0 rounded bg-black/30" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-zinc-100">{card.name}</div>
        <div className="truncate text-xs text-zinc-500">{card.label}</div>
      </div>
      <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-white">{card.price != null ? formatMoney(card.price) : "—"}</span>
      <button
        type="button"
        disabled={watched.has(card.id)}
        onClick={() => void watch(set, card)}
        className="shrink-0 rounded-full border border-edge px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:border-edge-strong hover:text-white disabled:border-transparent disabled:text-emerald-400"
      >
        {watched.has(card.id) ? "✓ Watching" : "Watch"}
      </button>
    </li>
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <div>
        <Link href="/app/collection" className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
          ← Inventory
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold text-white">Set completion</h1>
        <p className="mt-1 text-sm text-zinc-500">Every set you own a card from, what finishing it costs at today&apos;s prices, and the cheapest cards to get there.</p>
      </div>

      <GameToggle game={game} onChange={switchGame} block />

      {!sets ? (
        <div className="rounded-2xl border border-edge bg-surface-1 px-4 py-8 text-center text-sm text-zinc-500">Loading your {GAMES[game].label} sets…</div>
      ) : sets.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface-1 px-4 py-8 text-center text-sm text-zinc-400">
          <div className="font-semibold text-zinc-200">No {GAMES[game].label} sets started yet</div>
          <div className="mt-1">Scan a {GAMES[game].label} card and its set shows up here.</div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {sets.map((set) => {
            const isOpen = open === set.setId;
            const all = full[`${game}:${set.setId}`];
            const list = all && all !== "loading" ? all : set.cheapest;
            const done = set.missing === 0;
            return (
              <li key={set.setId} className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : set.setId)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-white">{set.setName}</span>
                      <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-white">
                        {set.owned} of {set.total}
                        <span className="ml-1.5 text-xs font-medium text-zinc-500">{set.pct}%</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/40">
                      <div className={`h-full rounded-full ${done ? "bg-emerald-400" : "bg-brand-400"}`} style={{ width: `${Math.max(2, set.pct)}%` }} />
                    </div>
                    <div className="mt-1.5 text-xs text-zinc-500">
                      {done
                        ? "Complete"
                        : `${set.missing} missing · finish for ${formatMoney(set.costToFinish)}${set.unpriced ? ` + ${set.unpriced} unpriced` : ""}`}
                    </div>
                  </div>
                  <span aria-hidden className={`text-zinc-500 transition ${isOpen ? "rotate-180" : ""}`}>⌄</span>
                </button>
                {isOpen && !done && (
                  <div className="border-t border-edge px-4 pb-3">
                    <div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      {all && all !== "loading" ? `All ${set.missing} missing, in set order` : `Cheapest ${Math.min(set.cheapest.length, 10)} to finish`}
                    </div>
                    <ul className="divide-y divide-edge">
                      {list.map((card) => (
                        <Card key={card.id} set={set} card={card} />
                      ))}
                    </ul>
                    {set.cheapest.length === 0 && !all && <p className="py-2 text-sm text-zinc-500">No prices yet for the missing cards.</p>}
                    {!all && set.missing > set.cheapest.length && (
                      <button type="button" onClick={() => void showAll(set.setId)} className="mt-1 text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
                        Show all {set.missing} missing →
                      </button>
                    )}
                    {all === "loading" && <p className="py-2 text-xs text-zinc-500">Loading…</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
