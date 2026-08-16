"use client";

import { GAMES, GAME_IDS } from "@/lib/games";
import type { GameId } from "@/lib/types";

interface Props {
  game: GameId;
  onChange: (game: GameId) => void;
  /** Header-row size. */
  compact?: boolean;
}

/**
 * Pokémon | Magic. Which catalogue the scanner reads against, which vision
 * prompt runs, which words go in the listing. Items already in the queue keep
 * the game they were added under.
 */
export default function GameToggle({ game, onChange, compact = false }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Card game"
      className={`inline-flex rounded-full border border-edge bg-surface-1 p-1 ${compact ? "text-xs" : "text-sm"}`}
    >
      {GAME_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={game === id}
          onClick={() => onChange(id)}
          className={`rounded-full font-medium transition ${compact ? "px-3 py-1" : "px-3.5 py-1.5"} ${
            game === id
              ? "bg-brand-500 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {GAMES[id].label}
        </button>
      ))}
    </div>
  );
}
