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

/**
 * set_code of every DON!! card (scripts/sync-onepiece.mjs --with-don, 10-01).
 * A DON!! card prints no number and no name beyond "DON!! CARD": the art is
 * the identity (a character, a compass), the same art comes plain and gold,
 * and prices run from cents to hundreds. name = "DON!! Card", subtitle = who
 * or what the art shows, variant = the feed's tag ("gold", a pack name),
 * set_name = the set it came in.
 */
export const ONE_PIECE_DON_SET = "DON";

/**
 * A DON!! row's id before "#don", from the feed's full name ("DON!! Card
 * (Koby) (Gold) - Premium Booster -The Best- Vol. 2 (PRB-02)"). The feed's
 * own id ("don_121") looks positional, so the id is the name: the sync and
 * the daily price refresh both derive it and must agree (test:tcg-prices).
 */
export function onePieceDonKey(fullName: string): string {
  return `don-${fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/**
 * The feed's DON!! names → the row. card_name "DON!! Card (Koby) (Gold)",
 * "DON!! Card // Green Compass", "DON!! Card (Tournament Pack Vol. 2)
 * [Winner]"; the full name appends " - <set>". Every tag but a trailing
 * "Gold" says what the card shows or where it came from, and goes in the
 * subtitle the scanner's read is matched against; Gold is the foil.
 */
export function parseOnePieceDon(cardName: string, fullName: string): { subtitle: string; variant: string; setName: string } {
  const rest = cardName.replace(/^DON!! Card\s*/i, "");
  const slash = /^\/\/\s*(.+)$/.exec(rest);
  const tags = slash ? [slash[1].trim()] : [...rest.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => (m[1] ?? m[2] ?? "").trim()).filter(Boolean);
  const gold = tags.length > 1 && tags.some((t) => /^gold$/i.test(t));
  return {
    subtitle: tags.filter((t) => !(gold && /^gold$/i.test(t))).join(" "),
    variant: gold ? "gold" : "",
    setName: fullName.startsWith(`${cardName} - `) ? fullName.slice(cardName.length + 3).trim() : "",
  };
}

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
export function printingLabel(card: { rarity?: string | null; variant?: string | null; setCode?: string | null; name?: string | null; setName?: string | null }): string {
  const v = (card.variant ?? "").toLowerCase();
  let words = PRINTING_WORDS[v];
  const titled = () => v.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if ((card.setCode ?? "").toUpperCase() === ONE_PIECE_DON_SET) {
    // "Uta · Gold · PRB-01": who is on it, the foil / pack tag, the set it came in.
    const who = (card.name ?? "").split(" - ").slice(1).join(" - ");
    const from = /\(([A-Z]{2,4}-?\d{0,3}[A-Z-]*)\)\s*$/.exec(card.setName ?? "")?.[1] ?? card.setName ?? "";
    return [who, v ? titled() : "", from].filter(Boolean).join(" · ") || "DON!! Card";
  }
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
export function printingChoices<T extends { id: string; number: string; rarity?: string | null; variant?: string | null; setCode?: string | null; imageSmall?: string | null; name?: string | null; setName?: string | null }>(
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
