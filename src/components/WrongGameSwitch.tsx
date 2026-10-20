"use client";

import { useOptionalSession } from "@/components/SessionProvider";
import { GAMES, gameOpen } from "@/lib/games";
import type { GameId } from "@/lib/types";

/**
 * "Switch to Lorcana" on a scan of another game's card (Chris 10-20: keep the
 * scan and ask the user to switch to what the card is). One tap flips the
 * scanner's game and reads the same photo again as that game. Nothing when the
 * game is not open to this seller (its switch is off), like the game toggle.
 */
export default function WrongGameSwitch({ game, onSwitch, className }: { game: GameId; onSwitch: () => void; className: string }) {
  const session = useOptionalSession();
  if (!gameOpen(game, session?.user?.features)) return null;
  return (
    <button type="button" onClick={onSwitch} className={className}>
      Switch to {GAMES[game].label}
    </button>
  );
}
