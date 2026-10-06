"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ArtImg from "@/components/ArtImg";
import { showsInLists } from "@/components/CardPagesUi";
import { cardKey, cardPath, gameTitle, parseCardKey, slugify } from "@/lib/cardPages";
import { searchTyped } from "@/lib/cards";
import { GAME_IDS } from "@/lib/games";
import { formatMoney, pickPrice, priceFlagOf } from "@/lib/listing";
import type { GameId, PokemonCard } from "@/lib/types";

/**
 * Search box for the public card pages (QoL 10-06): type a name, get cards that
 * link to their price pages. It reuses the scanner's own search (lib/cards.ts
 * searchTyped -> /api/search-card), so it needs no new route and shares that
 * route's per-IP rate limit. Typing is debounced (350 ms) and starts at two
 * characters; only the newest answer is shown. A card with no valid page key or
 * no picture gets no page, so it is left out. A flagged price is never printed.
 */

const MIN_CHARS = 2;
const DEBOUNCE_MS = 350;
const SHOWN = 8;

interface Hit {
  key: string;
  href: string;
  name: string;
  setName: string;
  number: string;
  image: string;
  price: number | null;
}

function toHits(game: GameId, cards: PokemonCard[]): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const c of cards) {
    const key = cardKey(game, c);
    if (parseCardKey(game, key) !== key || !c.imageSmall || seen.has(key)) continue;
    seen.add(key);
    const picked = priceFlagOf(c) ? null : (pickPrice(c)?.market ?? null);
    out.push({
      key,
      // The set slug here is a best guess; the card page 308s to the exact one.
      href: cardPath(game, slugify(c.setName), c.name, key),
      name: c.name,
      setName: c.setName,
      number: c.number,
      image: c.imageSmall,
      price: picked,
    });
    if (out.length >= SHOWN) break;
  }
  return out;
}

export default function CatalogSearch({
  game: fixedGame,
  games = GAME_IDS,
  variant = "page",
  autoFocus = false,
  onNavigate,
}: {
  /** Set on a game page: that game only, no picker. */
  game?: GameId;
  /** Offered in the picker when no game is fixed. */
  games?: readonly GameId[];
  variant?: "page" | "nav";
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const [pick, setPick] = useState<GameId>(games[0] ?? "pokemon");
  const game = fixedGame ?? pick;
  const [q, setQ] = useState("");
  // The newest answer with what it answered; anything else on screen is "still searching".
  const [res, setRes] = useState<{ term: string; game: GameId; hits: Hit[] | null } | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const mine = ++seq.current;
    if (term.length < MIN_CHARS) return;
    const t = setTimeout(() => {
      searchTyped(term, game, "en", { limit: 24, exact: false })
        .then((cards) => {
          if (mine === seq.current) setRes({ term, game, hits: toHits(game, cards ?? []) });
        })
        .catch(() => {
          if (mine === seq.current) setRes({ term, game, hits: null });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, game]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const term = q.trim();
  const showPanel = open && term.length >= MIN_CHARS;
  const current = res && res.term === term && res.game === game ? res : null;
  const hits = current?.hits ?? null;
  const failed = current !== null && current.hits === null;
  const busy = current === null;
  const label = fixedGame ? `Search ${gameTitle(fixedGame)} cards` : "Search cards";

  return (
    <div ref={wrap} className={`relative z-40 w-full ${variant === "page" ? "mt-5 max-w-xl" : ""}`}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className="flex items-center gap-2"
      >
        {!fixedGame && games.length > 1 && (
          <select
            aria-label="Game"
            value={pick}
            onChange={(e) => setPick(e.target.value as GameId)}
            className="h-11 shrink-0 rounded-xl border border-edge bg-surface-2 px-2 text-sm text-zinc-200 sm:text-base"
          >
            {games.map((g) => (
              <option key={g} value={g}>
                {gameTitle(g)}
              </option>
            ))}
          </select>
        )}
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={80}
          placeholder="Search a card name"
          aria-label={label}
          className="h-11 min-w-0 flex-1 rounded-xl border border-edge bg-surface-2 px-3 text-base text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none"
        />
      </form>

      {showPanel && (
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[70dvh] overflow-y-auto rounded-2xl border border-edge-strong panel-solid shadow-2xl shadow-black/60">
          {busy ? (
            <p className="px-4 py-3 text-sm text-zinc-400">Searching...</p>
          ) : failed ? (
            <p className="px-4 py-3 text-sm text-zinc-400">Search is busy. Try again in a moment.</p>
          ) : hits && hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400">No cards found. Try fewer words.</p>
          ) : (
            <ul className="divide-y divide-edge">
              {(hits ?? []).map((h) => (
                <li key={h.key}>
                  <Link
                    href={h.href}
                    onClick={() => {
                      setOpen(false);
                      onNavigate?.();
                    }}
                    className="flex items-center gap-3 px-3 py-2 transition hover:bg-white/5"
                  >
                    <span className="block h-14 w-10 shrink-0 overflow-hidden rounded bg-black/30">
                      {showsInLists(h.image) && <ArtImg src={h.image} alt="" loading="lazy" width={40} height={56} className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{h.name}</span>
                      <span className="block truncate text-xs text-zinc-400">
                        {h.setName}
                        {h.number ? ` · ${h.number}` : ""}
                      </span>
                    </span>
                    {h.price != null && <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-emerald-300">{formatMoney(h.price)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
