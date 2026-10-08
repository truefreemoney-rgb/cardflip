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
  // Every game after Pokémon is admins-only until its switch is flipped
  // (features come from /api/auth/me); a saved preference for a hidden game
  // snaps back to Pokémon, so nothing downstream sees it.
  const session = useOptionalSession();
  const features = session?.user?.features;
  const visible = GAME_IDS.filter((id) => id === "pokemon" || (features ? features[id as keyof typeof features] ?? true : true));
  const hidden = !visible.includes(game);
  useEffect(() => {
    if (hidden) onChange("pokemon");
  }, [hidden, onChange]);
  if (visible.length < 2) return null;
  // block (10-08, Chris: "i really hate the look of the bar"): the boxed, wrapping
  // pill group became one row of small chips that scrolls sideways on a phone.
  // No outer box, a 0 count is not printed (it was five "· 0" in a row), and the
  // row bleeds to the screen edge so the cut-off last chip says "scroll".
  if (block) {
    return (
      <div role="radiogroup" aria-label="Card game" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.map((id) => {
          const n = counts?.[id];
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={game === id}
              onClick={() => onChange(id)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 font-medium transition ${
                game === id ? "border-brand-500 bg-brand-500 text-white" : "border-edge bg-surface-1 text-zinc-400 hover:border-edge-strong hover:text-zinc-200"
              }`}
            >
              {GAMES[id].label}
              {n != null && n > 0 && <span className={game === id ? "ml-1 text-white/70" : "ml-1 text-zinc-500"}>{n}</span>}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label="Card game"
      className={`inline-flex rounded-full border border-edge bg-surface-1 p-1 ${visible.length > 4 ? "text-[11px]" : compact ? "text-xs" : "text-sm"}`}
    >
      {visible.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={game === id}
          onClick={() => onChange(id)}
          // Five games at text-xs px-2.5 measured 357px on a 375px phone
          // (09-29), past the 16px gutter; 11px / px-2 fits a 360px Android.
          className={`whitespace-nowrap rounded-full font-medium transition ${visible.length > 4 ? "px-2 py-1.5" : compact ? "px-3 py-1.5" : "px-3.5 py-1.5"} ${
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
