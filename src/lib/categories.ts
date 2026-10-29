/** Longest folder (category) name — shared by the sheet, the manager and the routes. */
export const CATEGORY_MAX = 40;

import type { GameId } from "@/lib/types";

/**
 * The sheet's "Auto" pick (Chris 10-29 1:43am: "an auto option instead of no category … put the card in
 * their set as a category, like we did with the truefreemoney magic cards but don't make all those weird
 * sub-categories … for all cards, in their chosen sets"). Never stored on a card: every card resolves to
 * its own set's name through setCategoryFor at write time. Remembered per account + game like any pick.
 */
export const AUTO_CATEGORY = "__auto__";

/** Magic's side sets fold into the parent set (feedback 10-24: one category per set, no sub-categories). */
const MTG_SIDE_SUFFIXES = [" Commander", " Art Series", " Promos", " Tokens", " Jumpstart Front Cards", " Jumpstart", " Minigames", " Substitute Cards", " Front Cards", " Extras"];
const MTG_PARENT: Record<string, string> = {
  // bonus sheets whose name is not the parent's (the 10-24 fold of Chris's own rows)
  "Marvel Universe": "Marvel's Spider-Man",
};

/**
 * The category a card files under on Auto: its set's name (a Magic side set = its parent set). An existing
 * category that already names the set, plainly or TCGplayer-style ("SV: White Flare" for White Flare), is
 * reused so the user's own spelling wins over a second folder.
 */
export function setCategoryFor(game: GameId, setName: string | null | undefined, existing: readonly string[] = []): string | null {
  let name = (setName ?? "").trim();
  if (!name) return null;
  if (game === "mtg") {
    name = MTG_PARENT[name] ?? name;
    for (const suffix of MTG_SIDE_SUFFIXES) {
      if (name.length > suffix.length && name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length).trim();
        break;
      }
    }
  }
  const low = name.toLowerCase();
  const match = existing.find((c) => {
    const cl = c.trim().toLowerCase();
    return cl === low || cl.endsWith(`: ${low}`);
  });
  return (match ?? name).slice(0, CATEGORY_MAX);
}

/** A sheet pick applied to one card: Auto becomes that card's set, anything else is itself. */
export function resolveCategory(pick: string | null, game: GameId, setName: string | null | undefined, existing: readonly string[] = []): string | null {
  return pick === AUTO_CATEGORY ? setCategoryFor(game, setName, existing) : pick;
}
