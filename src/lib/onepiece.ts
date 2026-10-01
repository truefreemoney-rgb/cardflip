/**
 * One Piece helpers shared by the near-tie picker (lib/tiebreak.ts) and the
 * scanner page / CardEditor. Client-safe: no DB.
 */

/**
 * Card number without the printing suffix the feed hangs on it:
 * "OP13-118_p2", "P-030_r1", "OP04-056_p2#2072" → "OP13-118", "P-030",
 * "OP04-056". Every printing of a card shares this key.
 */
export function onePieceKey(number: string): string {
  return number.trim().toUpperCase().replace(/_[RP]\d+.*$/, "").replace(/#.*$/, "");
}

/**
 * set_code of every promo printing (scripts/sync-onepiece.mjs --with-promos,
 * 10-01): event packs, judge packs, winner stamps, P-0xx. Ranked behind a
 * number's regular printings and kept out of the picture tiebreak.
 */
export const ONE_PIECE_PROMO_SET = "PROMO";

const PRINTING_WORDS: Record<string, string> = {
  "": "Standard",
  "alt-art": "Alt Art",
  parallel: "Parallel",
  special: "Special (SP)",
  spr: "Special (SPR)",
  manga: "Manga Art",
  "full-art": "Full Art",
  reprint: "Reprint",
  "pirate-foil": "Pirate Foil",
  "jolly-roger-foil": "Jolly Roger Foil",
  "textured-foil": "Textured Foil",
  "wanted-poster": "Wanted Poster",
  "box-topper": "Box Topper",
  "dash-pack": "Dash Pack",
  tr: "Treasure Rare",
};

/**
 * The printing a row sells as: "Parallel · SEC", "Reprint (PRB01) · SR". The
 * feed tags one-off alt arts with a set code or number ("op15-109") — those
 * read as "Alt Art"; a character-name tag ("bentham") is that character's
 * alt art and reads as the name. A reprint's face is the base's, so the set
 * it came from is what tells them apart.
 */
export function printingLabel(card: { rarity?: string | null; variant?: string | null; setCode?: string | null }): string {
  const v = (card.variant ?? "").toLowerCase();
  let words = PRINTING_WORDS[v];
  const titled = () => v.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if ((card.setCode ?? "").toUpperCase() === ONE_PIECE_PROMO_SET) {
    // Promo rows carry the pack as the tag ("cs-2023-celebration-pack",
    // "judge-pack-vol-5"); an untagged promo is "promo" / "promo-pr2".
    words =
      words !== undefined
        ? `Promo ${words}`
        : /^promo(-pr\d+)?$/.test(v)
          ? "Promo"
          : titled().replace(/\b(Cs|Tcg|Us|Uk|Jp|Sp|Tr|(?:Op|St|Eb|Prb)\d*)\b/g, (w) => w.toUpperCase());
  } else if (words === undefined) {
    words = /^[a-z]+\d*-\d+/.test(v) || /^\d/.test(v) ? "Alt Art" : titled();
  }
  const set = v === "reprint" && card.setCode && card.setCode.toUpperCase() !== ONE_PIECE_PROMO_SET ?` (${card.setCode.toUpperCase()})` : "";
  const rarity = card.rarity ? ` · ${card.rarity}` : "";
  return `${words}${set}${rarity}`;
}

/**
 * "Which printing?" (09-30, the Yu-Gi-Oh! "Which foil?" sibling): one One
 * Piece number comes as standard, parallel, alt art, manga, reprint…, prices
 * a hundred times apart, and a photo names the number far more reliably than
 * the printing (seller photos: 97% card, 49% printing). One card per printing
 * of the picked card's number, the pick first; two alt arts of one number
 * with different pictures are both offered (the thumbnail tells them apart).
 * Fewer than two = nothing to ask.
 */
export function printingChoices<T extends { id: string; number: string; rarity?: string | null; variant?: string | null; setCode?: string | null; imageSmall?: string | null }>(
  pick: T,
  candidates: T[],
): T[] {
  const key = onePieceKey(pick.number);
  const choiceKey = (c: T) => `${printingLabel(c)}|${c.imageSmall ?? ""}`;
  const byPrinting = new Map<string, T>([[choiceKey(pick), pick]]);
  for (const c of candidates) {
    if (c.id === pick.id || onePieceKey(c.number) !== key) continue;
    const k = choiceKey(c);
    if (!byPrinting.has(k)) byPrinting.set(k, c);
  }
  return byPrinting.size > 1 ? [...byPrinting.values()] : [];
}
