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
 * TCGplayer's event groups beside the boosters (tcgcsv category 68): "OP08 PRE" (pre-release), "OP17 RE" (release
 * event), "OP05 ANN" (anniversary tournament), "ST-01 PRE" (super pre-release). Every card in one is the booster's own
 * card with a stamp in the corner: same number, same art, its own price (Kingdew OP17-006 $0.08, its release event
 * copy $1.77 on 10-25). scripts/sync-onepiece-tcg.mjs files each under the booster's set with the stamp as the variant
 * ("release-event", or "release-event-bentham" when TCGplayer's name carries more), 10-25, Chris: every printing
 * TCGplayer sells is its own row and price.
 */
const STAMP_VARIANT = /^(super-pre-release|pre-release|release-event|anniversary)(?:-(.+))?$/;
const STAMP_WORDS: Record<string, string> = { "pre-release": "Pre-Release", "release-event": "Release Event", anniversary: "Anniversary", "super-pre-release": "Super Pre-Release" };

/** A stamped twin of a regular printing (above): ranked behind it like a promo, never a doubt of its own. */
export function isOnePieceStampedTwin(card: { variant?: string | null; setCode?: string | null }): boolean {
  return (card.setCode ?? "").toUpperCase() !== ONE_PIECE_PROMO_SET && STAMP_VARIANT.test((card.variant ?? "").toLowerCase());
}

/**
 * A promo or a stamped twin: the regular card's face with a pack or a stamp. Offered in "Which printing is yours?",
 * kept out of the picture tiebreak, and never the reason a scan says Check match (nearly every copy scanned is the
 * regular card).
 */
export function isOnePieceSideline(card: { variant?: string | null; setCode?: string | null }): boolean {
  return (card.setCode ?? "").toUpperCase() === ONE_PIECE_PROMO_SET || isOnePieceStampedTwin(card);
}

/**
 * The price CardFlip keeps for one TCGplayer One Piece product, from its tcgcsv /prices rows (one per subtype): the
 * market (last sales), else the asking price up to $20 (the Yu-Gi-Oh! / Magic rule, ASKING_MAX_USD in
 * lib/server/mtgTcgplayerFill.ts; test:tcgprices keeps the two equal). Twenty products list a Normal and a Foil line
 * (PRB-02 reprints, a few OP01-03 commons, P-043 Luffy Convention Promo $63.65 / $342.55): the catalog row is the
 * Normal one (every tied row sat at the Normal price, 10-25), so the Foil line is never taken for it. The nightly
 * (scripts/sync-onepiece-tcg.mjs) and the daily refresh (lib/server/tcgPriceRefresh.ts) both price with this, so the
 * 2am push and the 5am refresh agree.
 */
export const ONE_PIECE_ASKING_MAX_USD = 20;
export function onePieceProductPrice(rows: { subTypeName?: string | null; marketPrice?: unknown; midPrice?: unknown }[]): number | null {
  const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const normal = rows.filter((r) => r.subTypeName === "Normal");
  for (const r of normal.length ? normal : rows) {
    const market = pos(r.marketPrice);
    if (market != null) return market;
  }
  for (const r of normal.length ? normal : rows) {
    const mid = pos(r.midPrice);
    if (mid != null && mid <= ONE_PIECE_ASKING_MAX_USD) return mid;
  }
  return null;
}

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
  // TCGplayer's own printing words (scripts/sync-onepiece-tcg.mjs rows, 10-25).
  "super-alt-art": "Super Alt Art",
  "red-super-alt-art": "Red Super Alt Art",
  "super-leader-alt-art": "Super Leader Alt Art",
  gold: "Gold",
  silver: "Silver",
};

/**
 * A feed tag that is only a card number ("op15-109", "st18-004"): the feed's
 * "(OP15-109)" name suffix. On 10-25 the 80 such rows with a card page were
 * nearly all the regular card or a starter-deck reprint (Nico Robin OP15-109 R
 * $0.31), so a card page names no printing for them.
 */
export function isOnePieceNumberTag(variant: string | null | undefined): boolean {
  const v = (variant ?? "").toLowerCase();
  return /^[a-z]+\d*-\d+/.test(v) || /^\d/.test(v);
}

/**
 * A number tag in "Which printing is yours?" (10-25, the 80 such rows checked against TCGplayer): the regular card of
 * the row's own set reads "Standard" (50: Brook OP15-032 SR $3.45 sat beside its $28.75 alt art as a second "Alt Art"),
 * a starter deck's copy of another set's card reads "Reprint (ST20)" (26: Katakuri OP03-099 L $1.47). A booster's copy
 * of another set's card stays "Alt Art": both today are TCGplayer Treasure Rares (Zoro OP13-037 in OP15-EB04 $153.67,
 * Zoro-Juurou ST18-004 in OP09 $46.57), as do the tags with no set code ("9-034_p1", EB03's Heroines art).
 */
function numberTagWords(v: string, setCode: string | null | undefined): string {
  const code = /^([a-z]+\d*)-\d+/.exec(v)?.[1]?.toUpperCase();
  if (!code) return "Alt Art";
  const set = (setCode ?? "").toUpperCase();
  // "OP15EB04" (OP15-EB04) prints both OP15 and EB04 numbers as its own cards.
  if (!set || set.match(/[A-Z]+\d+/g)?.includes(code)) return "Standard";
  return /^ST\d/.test(set) ? `Reprint (${set})` : "Alt Art";
}

/**
 * The printing a row sells as: "Parallel · SEC", "Reprint (PRB01) · SR". A
 * card-number tag ("op15-109") is the set's regular card or a reprint
 * (numberTagWords); a character-name tag ("bentham") is that character's
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
  const stamp = (card.setCode ?? "").toUpperCase() === ONE_PIECE_PROMO_SET ? null : STAMP_VARIANT.exec(v);
  if (stamp) {
    // "Release Event · C", "Release Event Bentham · C": the stamp, then whatever else TCGplayer's name says.
    const rest = stamp[2] ? ` ${stamp[2].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}` : "";
    words = `${STAMP_WORDS[stamp[1]]}${rest}`;
  } else if ((card.setCode ?? "").toUpperCase() === ONE_PIECE_PROMO_SET) {
    // Promo rows carry the pack as the tag ("cs-2023-celebration-pack",
    // "judge-pack-vol-5"); an untagged promo is "promo" / "promo-pr2", and its
    // event sits in the name ("Tony Tony.Chopper (Offline Regional 2024 Vol. 3)
    // [Winner]"): 10-25, Chopper OP01-015 offered "Promo · UC" three times.
    const named = [...(card.name ?? "").matchAll(/[([]([^()[\]]+)[)\]]/g)].map((m) => m[1].replace(/\./g, "").trim()).filter(Boolean).join(" ");
    words =
      words !== undefined
        ? `Promo ${words}`
        : /^promo(-pr\d+)?$/.test(v)
          ? named || "Promo"
          : titled().replace(/\b(Cs|Tcg|Us|Uk|Jp|Sp|Tr|(?:Op|St|Eb|Prb)\d*)\b/g, (w) => w.toUpperCase());
  } else if (words === undefined) {
    words = isOnePieceNumberTag(v) ? numberTagWords(v, card.setCode) : titled();
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
