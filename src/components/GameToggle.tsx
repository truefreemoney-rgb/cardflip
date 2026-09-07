"use client";

import { useEffect } from "react";
import { useOptionalSession } from "@/components/SessionProvider";
import { GAMES, GAME_IDS } from "@/lib/games";
import type { GameId } from "@/lib/types";

interface Props {
  game: GameId;
  onChange: (game: GameId) => void;
  /** Header-row size. */
  compact?: boolean;
  /** Per-game counts shown inside the pills ("Magic · 12"). */
  counts?: Partial<Record<GameId, number>>;
  /** Stretch across the row with equal halves — the Inventory switch on phones. */
  block?: boolean;
}

/**
 * Pokémon | Magic. Which catalogue the scanner reads against, which vision
 * prompt runs, which words go in the listing. Items already in the queue keep
 * the game they were added under.
 */
export default function GameToggle({ game, onChange, compact = false, counts, block = false }: Props) {
  // Magic admins-only (09-04): the toggle vanishes for sellers and a saved
  // "mtg" preference snaps back to Pokémon, so nothing downstream sees it.
  const session = useOptionalSession();
  const magic = session?.user?.features?.magic ?? true;
  useEffect(() => {
    if (!magic && game === "mtg") onChange("pokemon");
  }, [magic, game, onChange]);
  if (!magic) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Card game"
      className={`${block ? "flex w-full" : "inline-flex"} rounded-full border border-edge bg-surface-1 p-1 ${compact ? "text-xs" : "text-sm"}`}
    >
      {GAME_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={game === id}
          onClick={() => onChange(id)}
          className={`rounded-full font-medium transition ${block ? "flex-1 py-2 text-center" : compact ? "px-3 py-1" : "px-3.5 py-1.5"} ${
            game === id
              ? "bg-brand-500 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {GAMES[id].label}
          {counts?.[id] != null && (
            <span className={game === id ? "ml-1.5 text-white/70" : "ml-1.5 text-zinc-600"}>· {counts[id]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
