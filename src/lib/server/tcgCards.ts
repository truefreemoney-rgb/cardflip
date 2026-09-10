import "server-only";
import { db } from "@/lib/db";
import type { GameId, PokemonCard } from "@/lib/types";
import { normalizeNumber, type PrintedNumber } from "@/lib/cardNumber";

/**
 * Lorcana + One Piece identification off the shared mirror (tcg_cards, see
 * scripts/sync-lorcana.mjs / sync-onepiece.mjs, docs/NEW-GAMES.md). The
 * printed key is the same shape as Pokémon's — name + number (+ set) — so
 * the ranking ladder is the en_cards one: exact name and number first, then
 * the tiebreaks a photo can settle (subtitle, variant, set code), newest
 * printing on a tie, rankScore exposed for the picture tiebreak.
 *
 * Lorcana prints "12/204 · 1" (number / set total · set number) and a
 * version line under the name; enchanted printings number past the total.
 * One Piece prints "OP01-077" bottom-left; parallels / alternate arts share
 * that id and differ only by the picture (the tiebreak's job).
 */

interface TcgRow {
  id: string;
  game: string;
  name: string;
  subtitle: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  set_total: number | null;
  set_release_date: string;
  rarity: string;
  variant: string;
  image_url: string;
  price_usd: number | null;
  price_usd_foil: number | null;
}

/** One Piece printings grouped by what the face shows (docs/NEW-GAMES.md). */
function onePieceVariantFamily(v: string): string {
  if (v === "" || v === "reprint") return "plain";
  if (v === "parallel" || v === "alt-art" || v === "special" || v === "spr" || v === "box-topper") return "alt";
  if (v === "manga") return "manga";
  if (v === "full-art") return "full";
  return "other";
}

const COLUMNS = "id, game, name, subtitle, set_code, set_name, collector_number, set_total, set_release_date, rarity, variant, image_url, price_usd, price_usd_foil";

export type TcgGame = Extract<GameId, "lorcana" | "onepiece">;
export const isTcgGame = (g: GameId): g is TcgGame => g === "lorcana" || g === "onepiece";

const fold = (s: string) => s.toLowerCase().replace(/[‘’‛′`´]/g, "'").replace(/[“”]/g, '"').replace(/-/g, " ").replace(/\s+/g, " ").trim();
const FOLDED = "REPLACE(REPLACE(REPLACE(LOWER(name), '-', ' '), '’', ''''), '‘', '''')";

function toCard(row: TcgRow): PokemonCard {
  const prices: PokemonCard["prices"] = [];
  if (row.price_usd != null) prices.push({ source: "tcgplayer", variant: "normal", market: row.price_usd, currency: "USD" } as PokemonCard["prices"][number]);
  if (row.price_usd_foil != null) prices.push({ source: "tcgplayer", variant: "foil", market: row.price_usd_foil, currency: "USD" } as PokemonCard["prices"][number]);
  return {
    id: row.id,
    name: row.subtitle ? `${row.name} - ${row.subtitle}` : row.name,
    setName: row.set_name,
    setSeries: "",
    number: row.collector_number,
    rarity: row.rarity || null,
    imageSmall: row.image_url,
    imageLarge: row.image_url,
    prices,
    englishName: null,
    setTotal: row.set_total,
    setCode: row.set_code || null,
    isSecretRare: row.variant === "enchanted" || row.variant === "special",
    game: row.game as GameId,
    variant: row.variant || null,
  } as PokemonCard;
}

export async function tcgCardById(id: string): Promise<PokemonCard[]> {
  const row = (await db.prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE id = ?`).get(id)) as TcgRow | undefined;
  return row ? [toCard(row)] : [];
}

export async function hasTcgMirror(game: TcgGame): Promise<boolean> {
  try {
    const row = (await db.prepare("SELECT 1 AS ok FROM tcg_cards WHERE game = ? LIMIT 1").get(game)) as { ok: number } | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

/** "OP01-077" → { setCode: "OP01", number: "OP01-077" }; "77" stays "77". */
export function splitOnePieceNumber(number: string): { setCode: string | null; number: string } {
  const m = /^([A-Z]{1,4}\d{1,3})-(\d{1,4})$/i.exec(number.trim());
  return m ? { setCode: m[1].toUpperCase(), number: `${m[1].toUpperCase()}-${m[2]}` } : { setCode: null, number: number.trim() };
}

const NAME_TIER = 8;

/** Same length, same letters, exactly one character different ("op13-118" vs "op10-018" is two — not this). */
function oneCharOff(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
  return diff === 1;
}

export async function searchTcgCardsLocal(
  game: TcgGame,
  name: string,
  printed: PrintedNumber | null,
  limit = 24,
  /** Lorcana version line / any subtitle the read saw. */
  subtitle: string | null = null,
  /** The printing the read saw: parallel / enchanted / alt-art / …; "standard" = plain. */
  variant: string | null = null,
): Promise<PokemonCard[]> {
  const needle = fold(name);
  let wantedNumber = printed ? normalizeNumber(printed.number) : null;
  let wantedCode = printed?.setCode ? printed.setCode.toUpperCase() : null;
  if (game === "onepiece" && wantedNumber) {
    // The read sometimes prepends the rarity printed beside the number
    // ("SP P-084", "SR OP05-119"); the catalog key is the number alone.
    const bare = printed!.number.trim().replace(/^(?:SP|SR|SEC|UC|R|C|L|P)\s+(?=[A-Z]{1,4}\d{0,3}-\d)/i, "");
    wantedNumber = normalizeNumber(bare);
    const split = splitOnePieceNumber(bare);
    if (split.setCode) { wantedCode = split.setCode; wantedNumber = normalizeNumber(split.number); }
  }

  let rows: TcgRow[] = [];
  if (needle) {
    rows = (await db
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = ? AND ${FOLDED} >= ? AND ${FOLDED} < ? ORDER BY set_release_date DESC LIMIT 400`)
      .all(game, needle, `${needle}￿`)) as unknown as TcgRow[];
    const numberSatisfied = !wantedNumber || rows.some((r) => normalizeNumber(r.collector_number) === wantedNumber);
    if (rows.length === 0 || !numberSatisfied) {
      const wide = (await db
        .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = ? AND ${FOLDED} LIKE ? ORDER BY set_release_date DESC LIMIT 400`)
        .all(game, `%${needle}%`)) as unknown as TcgRow[];
      const have = new Set(rows.map((r) => r.id));
      rows = rows.concat(wide.filter((r) => !have.has(r.id)));
    }
  }
  // No usable name (glare on the name band) but a full key identifies:
  // One Piece's "OP01-077" alone, or Lorcana's number + set number.
  if (rows.length === 0 && wantedNumber) {
    rows = (await db
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = ? AND collector_number = ? ${wantedCode ? "AND UPPER(set_code) = ?" : ""} ORDER BY set_release_date DESC LIMIT 100`)
      .all(...(wantedCode ? [game, printed!.number.trim(), wantedCode] : [game, printed!.number.trim()]))) as unknown as TcgRow[];
    if (rows.length === 0 && game === "lorcana") {
      rows = (await db
        .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = 'lorcana' AND collector_number = ? ${printed?.setTotal ? "AND set_total = ?" : ""} ORDER BY set_release_date DESC LIMIT 100`)
        .all(...(printed?.setTotal ? [wantedNumber, printed.setTotal] : [wantedNumber]))) as unknown as TcgRow[];
    }
  }
  if (rows.length === 0) return [];

  const wantedSub = subtitle ? fold(subtitle) : "";
  const wantedVariant = variant && variant !== "standard" ? variant : variant === "standard" ? "" : null;
  const score = (row: TcgRow): number => {
    // Some One Piece catalog rows carry the number inside the name
    // ("Roronoa Zoro - OP10-095"); the face just says Roronoa Zoro.
    const rowName = fold(game === "onepiece" ? row.name.replace(/\s+-\s+[A-Z]+\d*-\d+[a-z0-9_#]*$/i, "") : row.name);
    const exactName = needle !== "" && rowName === needle;
    // Reprint / parallel rows may carry their suffix in the number ("P-030_r1").
    const rowNumber = normalizeNumber(game === "onepiece" ? row.collector_number.replace(/_[rp]\d+$/i, "") : row.collector_number);
    const exactNumber = Boolean(wantedNumber) && rowNumber === wantedNumber;
    let tier: number;
    if (exactName && exactNumber) tier = 0;
    else if (exactNumber && needle === "") tier = 0;
    // Glare on a foil turns OP13-118 into OP10-018: with the name exact and
    // no printing of that name carrying the read number, the row one
    // character off is the likeliest — ahead of every other same-name row.
    else if (exactName && wantedNumber && game === "onepiece" && oneCharOff(rowNumber, wantedNumber)) tier = 0.5;
    else if (exactName) tier = 1;
    else if (exactNumber) tier = 2;
    else tier = 3;
    let p = tier * NAME_TIER;
    // Set: Lorcana's set number / One Piece's OP01 prefix. A wrong set costs
    // more than a tiebreak — it is a different card — but less than a name.
    // One Piece: the "OP06" the read sees is the card number's prefix, printed
    // identically on every printing of that card (a PRB01 alt art still says
    // OP06-079), so it carries nothing the number did not — no set penalty.
    if (game === "onepiece") { /* number already compared */ }
    else if (wantedCode && row.set_code) p += row.set_code.toUpperCase() === wantedCode ? 0 : 4;
    else if (wantedCode) p += 1;
    // Lorcana denominator = set total.
    if (printed?.setTotal && row.set_total) p += row.set_total === printed.setTotal ? 0 : 3;
    // Subtitle (Lorcana version line) separates "Ariel - On Human Legs" from "Ariel - Spectacular Singer".
    if (wantedSub && row.subtitle) {
      const rowSub = fold(row.subtitle);
      p += rowSub === wantedSub || rowSub.includes(wantedSub) || wantedSub.includes(rowSub) ? 0 : 3;
    }
    // Variant read off the face: the plain printing is the likelier one
    // when nothing special was seen; a seen variant lifts its row.
    if (wantedVariant !== null && game === "onepiece") {
      // Compare by family: the read says "parallel" for alt-art / special /
      // SPR rows alike; a starter-deck reprint has the same face as the base.
      const want = onePieceVariantFamily(wantedVariant);
      const have = onePieceVariantFamily(row.variant || "");
      // A reprint's face is identical to the base — keep it past the
      // near-tie gap so the picture is not asked to tell twins apart.
      // Two art families ("full-art" read, "special" row) are both "a
      // different picture was seen" — closer to each other than to plain.
      // Foil treatments of the standard art (pirate / jolly-roger foil) are
      // not: a full-art read is not evidence for them.
      const ART = new Set(["alt", "full", "manga"]);
      if (want === have) p += row.variant === "reprint" ? 1.25 : 0;
      else if (want === "plain" || have === "plain") p += 1;
      else if (ART.has(want) && ART.has(have)) p += 0.5;
      else p += 1.5;
    } else if (wantedVariant !== null) {
      const rowV = row.variant || "";
      if (wantedVariant === "" ) p += rowV === "" ? 0 : 1;
      else p += rowV === wantedVariant ? 0 : rowV === "" ? 1 : 2;
    } else if (row.variant) p += 0.25;
    if (row.price_usd == null && row.price_usd_foil == null) p += 0.5;
    return p;
  };
  const scored = rows.map((row) => ({ row, s: score(row) })).sort((a, b) => a.s - b.s).slice(0, limit);
  return scored.map((x) => ({ ...toCard(x.row), rankScore: x.s }));
}
