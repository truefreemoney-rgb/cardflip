import "server-only";
import { db } from "@/lib/db";
import type { GameId, PokemonCard } from "@/lib/types";
import { normalizeNumber, type PrintedNumber } from "@/lib/cardNumber";
import { TIEBREAK_GAP } from "@/lib/tiebreak";
import { yugiohKey } from "@/lib/yugioh";
import { ONE_PIECE_DON_SET, ONE_PIECE_PROMO_SET } from "@/lib/onepiece";
import type { SetInfo } from "@/lib/grading";
import { cachedList, SET_LIST_TTL_MS } from "@/lib/server/listCache";

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

export type TcgGame = Extract<GameId, "lorcana" | "onepiece" | "yugioh">;
export const isTcgGame = (g: GameId): g is TcgGame => g === "lorcana" || g === "onepiece" || g === "yugioh";

// Set code without the language letters; lives in lib/yugioh.ts so the scanner page shares it.
export { yugiohKey };

/** "Quarter Century Secret Rare" / "quarter-century-secret-rare" → one slug. */
const raritySlug = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// A card prints brackets the catalog leaves out ("Maliss <Q> Hearts Crypter" is filed "Maliss Q Hearts Crypter",
// 10-01 seller photos: the read with 〈Q〉 found nothing), so a searched name loses them.
// Same for a printed star ("Yummyusment☆Acroquey" is filed "YummyusmentAcroquey", 10-01 blurred-number sample).
const BRACKETS = /[〈〉《》＜＞<>★☆]/g;
const fold = (s: string) => s.toLowerCase().replace(BRACKETS, "").replace(/[‘’‛′`´]/g, "'").replace(/[“”]/g, '"').replace(/-/g, " ").replace(/\s+/g, " ").trim();
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

/**
 * The picture the vision tiebreak compares against. One Piece keeps Bandai's
 * stamped card-list art in ref_image_url for exactly this (the model reads
 * through a "SAMPLE" stamp fine; people must never see it — image_url is the
 * clean scan or nothing). Other games: the shown picture.
 */
export async function tcgReferenceImage(id: string): Promise<string | null> {
  try {
    const row = (await db.prepare("SELECT image_url, ref_image_url FROM tcg_cards WHERE id = ?").get(id)) as { image_url: string; ref_image_url: string } | undefined;
    if (!row) return null;
    return row.ref_image_url || row.image_url || null;
  } catch {
    // Prod before the column probe ran: the shown picture.
    return (await tcgCardById(id))[0]?.imageLarge ?? null;
  }
}

export async function tcgCardById(id: string): Promise<PokemonCard[]> {
  const row = (await db.prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE id = ?`).get(id)) as TcgRow | undefined;
  return row ? [toCard(row)] : [];
}

/**
 * The set browser (Search Cards / Watchlist "By set"). Until 09-30 /api/sets
 * and /api/set-cards knew only Pokémon + Magic, so Lorcana / One Piece /
 * Yu-Gi-Oh! listed Pokémon's sets. Key = "code|name": Yu-Gi-Oh! reuses a
 * code across sets (DCR-EN = Dark Crisis 25th and Worldwide English).
 */
export async function listTcgSets(game: TcgGame): Promise<SetInfo[]> {
  return cachedList(`sets:v1:${game}`, SET_LIST_TTL_MS, async () => {
    // One Piece promos (set_code PROMO): 1,082 loose printings with no
    // pictures are not a set to browse; scan and name search reach them.
    // DON!! cards (set_code DON) carry the name of the set they came in, which
    // would list every such set twice.
    const rows = (await db
      .prepare(
        `SELECT set_code, set_name, MIN(set_release_date) AS release_date
           FROM tcg_cards WHERE game = ? AND set_code NOT IN ('${ONE_PIECE_PROMO_SET}', '${ONE_PIECE_DON_SET}')
          GROUP BY set_code, set_name
          ORDER BY release_date DESC, set_name`,
      )
      .all(game)) as unknown as { set_code: string; set_name: string; release_date: string }[];
    return rows.map((r) => ({ name: r.set_name || r.set_code, releaseDate: r.release_date ?? "", logoUrl: "", code: `${r.set_code}|${r.set_name}` }));
  });
}

/** Every card in one set ("code|name" from listTcgSets, or a bare code), printed order. */
export async function tcgCardsBySet(game: TcgGame, key: string): Promise<PokemonCard[]> {
  const cut = key.indexOf("|");
  const code = cut < 0 ? key : key.slice(0, cut);
  const name = cut < 0 ? null : key.slice(cut + 1);
  const rows = (await db
    .prepare(
      `SELECT ${COLUMNS} FROM tcg_cards
        WHERE game = ? AND set_code = ? ${name != null ? "AND set_name = ?" : ""}
        ORDER BY CAST(collector_number AS INTEGER), collector_number, variant`,
    )
    .all(...(name != null ? [game, code, name] : [game, code]))) as unknown as TcgRow[];
  return rows.map(toCard);
}

/**
 * Current catalog price per id (plain, else foil) for Lorcana / One Piece /
 * Yu-Gi-Oh! rows — they have no price_series, so the watchlist alert sweep
 * reads this instead (09-30: alerts on those games could never fire).
 */
export async function tcgCatalogPrices(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (!chunk.length) break;
    const rows = (await db
      .prepare(`SELECT id, price_usd, price_usd_foil FROM tcg_cards WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk)) as unknown as { id: string; price_usd: number | null; price_usd_foil: number | null }[];
    for (const r of rows) {
      const p = r.price_usd ?? r.price_usd_foil;
      if (p != null) out.set(r.id, p);
    }
  }
  return out;
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

/** Levenshtein distance (short strings: set codes and card names). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Same length, same letters, exactly one character different ("op13-118" vs "op10-018" is two — not this). */
function oneCharOff(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
  return diff === 1;
}

/**
 * Same shape, exactly two DIGITS different, letters and dashes intact
 * ("op13-118" read as "op10-018"; never "op" vs "st"). Glare on a SEC foil
 * did this to a 09-10 seller photo: the one-digit-off row (OP10-118) took
 * the top spot and the picture tiebreak was handed two wrong faces.
 */
function twoDigitsOff(read: string, row: string): number | null {
  if (read.length !== row.length || read === row) return null;
  let diff = 0;
  let firm = 0;
  for (let i = 0; i < read.length; i++) {
    if (read[i] === row[i]) continue;
    if (!/\d/.test(read[i]) || !/\d/.test(row[i]) || ++diff > 2) return null;
    // Glare wipes strokes: a digit read as 0 could have been anything; a
    // digit read as something else is a firmer claim the row contradicts.
    if (read[i] !== "0") firm++;
  }
  return diff === 2 ? firm : null;
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
  /** Yu-Gi-Oh!: the "1st Edition" stamp seen (true), looked for and absent (false), unread (null). */
  firstEdition: boolean | null = null,
  /** A seller typed this in a search box: match the words anywhere in the
   * name ("luffy" → Monkey.D.Luffy, "magician" → Dark Magician), not only
   * as its start. Scanner reads leave it off (full printed names). */
  typed = false,
): Promise<PokemonCard[]> {
  const needle = fold(name);
  let wantedNumber = printed ? normalizeNumber(printed.number) : null;
  let wantedCode = printed?.setCode ? printed.setCode.toUpperCase() : null;
  if (game === "yugioh") return searchYugioh(needle, name, printed, limit, variant, firstEdition, typed);
  let onePieceKeyRead: string | null = null;
  if (game === "onepiece" && wantedNumber) {
    // The read sometimes prepends the rarity printed beside the number
    // ("SP P-084", "SR OP05-119"); the catalog key is the number alone.
    const bare = printed!.number.trim().replace(/^(?:SP|SR|SEC|UC|R|C|L|P)\s+(?=[A-Z]{1,4}\d{0,3}-\d)/i, "");
    wantedNumber = normalizeNumber(bare);
    const split = splitOnePieceNumber(bare);
    if (split.setCode) { wantedCode = split.setCode; wantedNumber = normalizeNumber(split.number); onePieceKeyRead = split.number; }
    // Promos print "P-055": a full key with no set in it. The read's setCode
    // ("P") is not a catalog set (those rows sit under PRB01 / the promo
    // group), so it must never filter — a Japanese-name P-055 found nothing
    // (10-01 seller photo).
    else if (/^P-\d{3,4}$/i.test(bare)) { wantedCode = "P"; onePieceKeyRead = bare.toUpperCase(); }
  }

  // A typed "don koby" / "gold don luffy" / "don": DON!! cards carry who is
  // on them in the subtitle (the name is "DON!! Card" for all 187), so the
  // other words are looked for there, in the foil tag and in the set name.
  if (game === "onepiece" && typed && /(^|\s)don(!!)?(\s|$)/.test(needle)) {
    const words = needle.split(/\s+/).filter((w) => !/^(don(!!)?|cards?)$/.test(w));
    const don = ((await db
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = 'onepiece' AND set_code = '${ONE_PIECE_DON_SET}' ORDER BY price_usd IS NULL, price_usd LIMIT 400`)
      .all()) as unknown as TcgRow[]).filter((r) => { const hay = fold(`${r.subtitle} ${r.variant} ${r.set_name}`); return words.every((w) => hay.includes(w)); });
    if (don.length) return don.slice(0, limit).map((row, i) => ({ ...toCard(row), rankScore: i }));
  }

  let rows: TcgRow[] = [];
  if (needle) {
    rows = (await db
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = ? AND ${FOLDED} >= ? AND ${FOLDED} < ? ORDER BY set_release_date DESC LIMIT 400`)
      .all(game, needle, `${needle}￿`)) as unknown as TcgRow[];
    const numberSatisfied = !wantedNumber || rows.some((r) => normalizeNumber(r.collector_number) === wantedNumber);
    if (rows.length === 0 || !numberSatisfied || typed) {
      const wide = (await db
        .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = ? AND ${FOLDED} LIKE ? ORDER BY set_release_date DESC LIMIT 400`)
        .all(game, `%${needle}%`)) as unknown as TcgRow[];
      const have = new Set(rows.map((r) => r.id));
      rows = rows.concat(wide.filter((r) => !have.has(r.id)));
    }
    // One Piece: no printing of the read name carries the read key, but the
    // key names exactly one card — an event card whose art the read named
    // ("Cross Guild" read as Buggy). Its rows join the candidates (tier 0.55
    // below) so the picture can weigh it against the same-name digit-off rows.
    if (game === "onepiece" && onePieceKeyRead && !numberSatisfied) {
      const byKey = (await db
        .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = 'onepiece' AND collector_number LIKE ? LIMIT 20`)
        .all(`${onePieceKeyRead}%`)) as unknown as TcgRow[];
      const have = new Set(rows.map((r) => r.id));
      rows = rows.concat(byKey.filter((r) => !have.has(r.id)));
    }
  }
  // No usable name (glare on the name band) but a full key identifies:
  // One Piece's "OP01-077" alone, or Lorcana's number + set number.
  if (rows.length === 0 && wantedNumber) {
    // One Piece: the key is the whole identity and a reprint keeps it under
    // another set (OP06-079 in PRB01), so the set never narrows it.
    const bySet = game === "onepiece" && onePieceKeyRead ? null : wantedCode;
    const key = game === "onepiece" && onePieceKeyRead ? onePieceKeyRead : printed!.number.trim();
    rows = (await db
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = ? AND collector_number = ? ${bySet ? "AND UPPER(set_code) = ?" : ""} ORDER BY set_release_date DESC LIMIT 100`)
      .all(...(bySet ? [game, key, bySet] : [game, key]))) as unknown as TcgRow[];
    if (rows.length === 0 && game === "lorcana") {
      rows = (await db
        .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = 'lorcana' AND collector_number = ? ${printed?.setTotal ? "AND set_total = ?" : ""} ORDER BY set_release_date DESC LIMIT 100`)
        .all(...(printed?.setTotal ? [wantedNumber, printed.setTotal] : [wantedNumber]))) as unknown as TcgRow[];
    }
  }
  if (rows.length === 0) return [];

  const wantedSub = subtitle ? fold(subtitle) : "";
  const wantedVariant = variant && variant !== "standard" ? variant : variant === "standard" ? "" : null;
  // Some One Piece catalog rows carry the number inside the name
  // ("Roronoa Zoro - OP10-095"); the face just says Roronoa Zoro.
  const nameOf = (row: TcgRow) => fold(game === "onepiece" ? row.name.replace(/\s+-\s+[A-Z]+\d*-\d+[a-z0-9_#]*$/i, "") : row.name);
  // Reprint / parallel rows may carry their suffix in the number ("P-030_r1").
  const numberOf = (row: TcgRow) => normalizeNumber(game === "onepiece" ? row.collector_number.replace(/_[rp]\d+$/i, "") : row.collector_number);
  // One Piece numbers that have a regular (non-promo) printing among the candidates.
  const regularNumbers = new Set(game === "onepiece" ? rows.filter((r) => r.set_code !== ONE_PIECE_PROMO_SET).map(numberOf) : []);
  // A shaky One Piece read whose number does name a card of the read name.
  const shakyHit =
    game === "onepiece" && Boolean(printed?.shaky) && needle !== "" && Boolean(wantedNumber) && rows.some((r) => nameOf(r) === needle && numberOf(r) === wantedNumber);
  const score = (row: TcgRow): number => {
    const rowName = nameOf(row);
    const exactName = needle !== "" && rowName === needle;
    const rowNumber = numberOf(row);
    const exactNumber = Boolean(wantedNumber) && rowNumber === wantedNumber;
    const twoOff = exactName && !exactNumber && wantedNumber && game === "onepiece" ? twoDigitsOff(wantedNumber, rowNumber) : null;
    let tier: number;
    if (exactName && exactNumber) tier = 0;
    else if (exactNumber && needle === "") tier = 0;
    // A shaky read (unsure even after the close-up) can land on a number that
    // exists: "OP13-118" read as "OP10-118", both a Monkey.D.Luffy SEC (10-01
    // re-read of the 09-10 seller photo). The same name one character off
    // comes inside the gap, so the picture confirms the number or corrects it.
    else if (shakyHit && exactName && oneCharOff(rowNumber, wantedNumber!)) tier = 0.1;
    // Glare on a foil turns OP13-118 into OP10-018: with the name exact and
    // no printing of that name carrying the read number, the row one
    // character off is the likeliest — ahead of every other same-name row.
    else if (exactName && wantedNumber && game === "onepiece" && oneCharOff(rowNumber, wantedNumber)) tier = 0.5;
    // The small promo key loses its last digits to glare ("P-005" read as
    // "P-00", 10-01 seller photo): that name's promo starting with what was
    // read is the likeliest, ahead of the same name's regular cards.
    else if (exactName && wantedNumber && game === "onepiece" && /^p-\d{1,2}$/.test(wantedNumber) && /^p-\d{3,4}$/.test(rowNumber) && rowNumber.startsWith(wantedNumber)) tier = 0.5;
    // Two digits off lands 0.8 behind the one-off row: inside the near-tie
    // gap (lib/tiebreak.ts), so the picture — not the misread — decides
    // (tiebreakIds sends the distinct numbers within the gap).
    else if (twoOff !== null) tier = 0.6;
    // One Piece: a full key ("OP09-057") names exactly one card, and the
    // read names the character in the art when the card is an event ("Cross
    // Guild" read as Buggy, 09-30 seller photo). The number's row sits just
    // behind a same-name one-digit-off row — inside the gap, the picture decides.
    else if (exactNumber && game === "onepiece" && wantedCode) tier = 0.55;
    // Glare past two digits ("OP06-119" read as "OP06-093", 09-30 seller
    // photo, a SEC foil): the name and the set prefix both survived. That
    // name's cards in that set sit inside the gap behind the read key's own
    // card (Perona OP06-093), so the picture decides — and ahead of the
    // same name in every other set when the read key names nothing.
    // (Not promos: "P" is no set — every P-0xx of a name would crowd in.)
    else if (exactName && game === "onepiece" && wantedCode && wantedCode !== "P" && wantedNumber && rowNumber.split("-")[0] === wantedNumber.split("-")[0]) tier = 0.65;
    else if (exactName) tier = 1;
    else if (exactNumber) tier = 2;
    else tier = 3;
    let p = tier * NAME_TIER;
    // Among the two-off rows, the ones whose differing digits were read as 0
    // (glare) come before the ones contradicting a firmly read digit.
    if (twoOff) p += 0.1 * twoOff;
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
    if (wantedSub && game === "onepiece" && row.set_code === ONE_PIECE_DON_SET) {
      // DON!! card: the read names who the art shows ("Monkey.D.Luffy"), the
      // feed tags it its own way ("Luffy", "GEAR5 Luffy", "Luffy Special
      // DON!! Set Vol. 1") — one shared word of three letters or more is a match.
      const words = (s: string) => s.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const have = new Set(words(fold(row.subtitle)));
      p += words(wantedSub).some((w) => have.has(w)) ? 0 : 3;
    } else if (wantedSub && row.subtitle) {
      const rowSub = fold(row.subtitle);
      p += rowSub === wantedSub || rowSub.includes(wantedSub) || wantedSub.includes(rowSub) ? 0 : 3;
    }
    // Variant read off the face: the plain printing is the likelier one
    // when nothing special was seen; a seen variant lifts its row.
    const promoOnly = game === "onepiece" && row.set_code === ONE_PIECE_PROMO_SET && !regularNumbers.has(rowNumber);
    const don = game === "onepiece" && row.set_code === ONE_PIECE_DON_SET;
    if (promoOnly || don) {
      // A promo-only number's variant is its pack tag ("sealed-battle-kit-vol-1"),
      // not an art family: a "parallel" read says nothing for or against it.
      // Same for a DON!! card ("gold", a pack name): the read names who is on
      // it (subtitle, above), the picture and the seller's tap pick the rest —
      // cheapest first, the copy most people hold.
      if (don) p += Math.min(row.price_usd ?? 9999, 9999) / 1e6;
    } else if (wantedVariant !== null && game === "onepiece") {
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
    // One Piece promo printings (set_code PROMO, 10-01): a judge-pack or
    // winner-stamp copy of a regular number is rare and looks like the
    // regular card to a photo. They sit past the near-tie gap behind that
    // number's regular rows — offered in "Which printing is yours?", never a
    // reason for a picture call — and the cheapest (the mass promo) leads
    // when a number is promo-only. A promo-only number ("P-056") has no
    // regular row to stand behind: one flat point and no variant penalty
    // keeps it inside the picture's gap when a digit is misread (Zoro P-056
    // read as P-058, 10-01 seller photo: at 1.25 + a variant mismatch it
    // never reached the picture), and still behind a regular-set row of the
    // same name, which is the card more people own.
    if (game === "onepiece" && row.set_code === ONE_PIECE_PROMO_SET) p += (promoOnly ? 1 : 1.25) + Math.min(row.price_usd ?? 9999, 9999) / 1e6;
    return p;
  };
  const scored = rows.map((row) => ({ row, s: score(row) })).sort((a, b) => a.s - b.s).slice(0, limit);
  return scored.map((x) => ({ ...toCard(x.row), rankScore: x.s }));
}

/**
 * Yu-Gi-Oh! (09-29): the printed key is the set code ("LOB-EN005"), which
 * names one card in one set; the same code can come in several rarities
 * (Ultra and Secret of one reprint set are different price lines, told apart
 * by the foil), and most printings sell as 1st Edition and Unlimited — the
 * stamp under the art decides, and it is worth far more ("-1st" rows,
 * scripts/sync-yugioh.mjs).
 */
async function searchYugioh(
  needle: string,
  rawName: string,
  printed: PrintedNumber | null,
  limit: number,
  rarity: string | null,
  firstEdition: boolean | null,
  typed = false,
): Promise<PokemonCard[]> {
  const wantedKey = printed ? yugiohKey(printed.number) : null;
  let rows: TcgRow[] = [];
  if (wantedKey) {
    const [prefix, digits] = wantedKey.split("-");
    rows = (await db
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = 'yugioh' AND collector_number IN (?, ?, ?) LIMIT 60`)
      .all(`${prefix}-${digits}`, `${prefix}-EN${digits}`, `${prefix}-E${digits}`)) as unknown as TcgRow[];
  }
  // The SQL fold turns "-" into a space but keeps the spaces around it
  // ("destiny hero   plasma"); fold() collapses them, so range-scan with the
  // SQL's own spelling or every "X - Y" name finds nothing (09-29 panel).
  const sqlFold = (s: string) => s.toLowerCase().replace(BRACKETS, "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").replace(/ - /g, " \u0000 ").replace(/-/g, " ").replace(/\u0000/g, " ").trim();
  const byNameRows = async (n: string) => {
    // INDEXED BY: prod's planner (no ANALYZE stats) picked the number index
    // and walked all 60k rows (09-29 EXPLAIN on Turso).
    const key = sqlFold(n);
    return (await db
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards INDEXED BY idx_tcg_cards_game_folded WHERE game = 'yugioh' AND ${FOLDED} >= ? AND ${FOLDED} < ? ORDER BY set_release_date DESC LIMIT 400`)
      .all(key, `${key}￿`)) as unknown as TcgRow[];
  };
  // The number is unread, or it read wrong (none of its rows has this name):
  // every printing of the name, newest first.
  if (needle && !rows.some((r) => fold(r.name) === needle)) {
    let byName = await byNameRows(rawName);
    // The card says "Ancient Gear Token"; most catalog rows say "Token: Ancient Gear".
    const token = /^(.+) token$/.exec(needle);
    if (token && !byName.some((r) => fold(r.name) === needle)) {
      const alt = await byNameRows(`token: ${token[1]}`);
      if (alt.length) { byName = alt.concat(byName); needle = fold(`token: ${token[1]}`); }
    }
    const have = new Set(rows.map((r) => r.id));
    rows = rows.concat(byName.filter((r) => !have.has(r.id)));
  }
  if ((rows.length === 0 || (typed && rows.length < limit)) && needle) {
    const wide = (await db
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = 'yugioh' AND ${FOLDED} LIKE ? ORDER BY set_release_date DESC LIMIT 200`)
      .all(`%${sqlFold(rawName)}%`)) as unknown as TcgRow[];
    const have = new Set(rows.map((r) => r.id));
    rows = rows.concat(wide.filter((r) => !have.has(r.id)));
  }
  // Name AND code both misread by a letter or two ("Materia Beast" PGL2-EN066
  // for Naturia Beast PGL2-EN086, 09-29 panel): the set's rows whose code is
  // a character off and whose name is a couple of letters off.
  let fuzzyIds = new Set<string>();
  if (wantedKey && needle && !rows.some((r) => fold(r.name) === needle)) {
    const prefix = wantedKey.split("-")[0];
    const setRows = (await db
      // A range, not LIKE: LIKE is case-insensitive and skips the (game, collector_number) index. "." sorts right after "-".
      .prepare(`SELECT ${COLUMNS} FROM tcg_cards WHERE game = 'yugioh' AND collector_number >= ? AND collector_number < ? LIMIT 800`)
      .all(`${prefix}-`, `${prefix}.`)) as unknown as TcgRow[];
    const near = setRows.filter((r) => editDistance(yugiohKey(r.collector_number) ?? "", wantedKey) <= 1 && editDistance(fold(r.name), needle) <= 2);
    fuzzyIds = new Set(near.map((r) => r.id));
    const have = new Set(rows.map((r) => r.id));
    rows = rows.concat(near.filter((r) => !have.has(r.id)));
  }
  if (rows.length === 0) return [];

  let wantRarity = rarity && rarity !== "unknown" && rarity !== "standard" ? raritySlug(rarity) : null;
  // "ultra-rare-purple": an Ultra Rare whose name foil is purple — the catalog tags that row variant "purple".
  const COLORS = ["blue", "green", "purple", "red", "bronze", "silver"];
  const colorMatch = wantRarity ? /^ultra-rare-([a-z]+)$/.exec(wantRarity) : null;
  const wantColor = colorMatch && COLORS.includes(colorMatch[1]) ? colorMatch[1] : null;
  if (wantColor) wantRarity = "ultra-rare";
  const score = (row: TcgRow): number => {
    const exactName = needle !== "" && (fold(row.name) === needle || fuzzyIds.has(row.id));
    const rowKey = yugiohKey(row.collector_number) ?? "";
    const exactNumber = Boolean(wantedKey) && rowKey === wantedKey;
    // Up to two characters off on the code with the name exact ("SGX3-EN127"
    // for ENI27, "MP15" for SP15, "PST-054" for PSV-064): that printing, ahead
    // of the name's other sets. Same digits in another set ("MP23-EN001" for
    // SR01-EN001) is the next-best clue.
    // At most one slip in the set part AND one in the number: "YS14-EN028"
    // must not pull YS14-EN033 over the real YS16-EN035 (two digit slips).
    const [rowSet, rowDigits] = rowKey.split("-");
    const [wantSet, wantDigits] = (wantedKey ?? "-").split("-");
    const nearNumber = !exactNumber && Boolean(wantedKey) && Boolean(rowKey) && editDistance(rowSet, wantSet) <= 1 && editDistance(rowDigits ?? "", wantDigits) <= 1;
    const sameDigits = !exactNumber && Boolean(wantedKey) && rowDigits === wantDigits;
    let tier: number;
    if (exactNumber && (exactName || needle === "")) tier = 0;
    else if (exactName && nearNumber) tier = 0.5;
    // A soft clue: a rarity read that fits another printing still outweighs it.
    else if (exactName && sameDigits) tier = 0.9;
    else if (exactName) tier = 1;
    else if (exactNumber) tier = 2;
    else tier = 3;
    let p = tier * NAME_TIER;
    // Rarity off the foil: "prismatic secret" read against a "secret" row is closer than "common".
    if (wantRarity) {
      const have = raritySlug(row.rarity);
      // Same family (gold / premium gold / gold secret; any two duel terminal foils) beats a foil from another family.
      // The Battle Pack pattern foils are one family too (10-01 seller photos): the read names the wrong one of
      // starfoil / mosaic / shatterfoil, each pack prints only one, and the miss used to fall to that code's Common.
      const family = (s: string) => (s.includes("gold") ? "gold" : s.startsWith("duel-terminal") ? "duel-terminal" : /starfoil|mosaic|shatterfoil/.test(s) ? "pattern-foil" : null);
      // "secret-rare" inside "prismatic-secret-rare" is a partial match; plain "rare" inside everything is not.
      const shorter = have.length < wantRarity.length ? have : wantRarity;
      const partial = shorter !== "rare" && shorter !== "common" && (have.includes(wantRarity) || wantRarity.includes(have));
      p += have === wantRarity || (wantRarity === "duel-terminal" && have.startsWith("duel-terminal")) ? 0 : partial ? 0.75 : family(have) && family(have) === family(wantRarity) ? 0.75 : 1.5;
    }
    const isFirst = row.id.endsWith("-1st");
    if (firstEdition === true) p += isFirst ? 0 : 1.5;
    else if (firstEdition === false) p += isFirst ? 1.5 : 0;
    else if (isFirst) p += 0.25;
    // Tagged rows ("(Red)", "(Alternate Art)") are the rarer face; the picture settles them.
    if (wantColor) p += row.variant === wantColor ? 0 : 1;
    else if (row.variant) p += COLORS.includes(row.variant) && wantRarity ? 1 : 0.25;
    if (row.price_usd == null) p += 0.5;
    return p;
  };
  const scored = rows.map((row) => ({ row, s: score(row) })).sort((a, b) => a.s - b.s);
  // The foil read off a photo is the weak link (09-29 panel: right code,
  // wrong rarity on most misses). When the winning code also comes in
  // another rarity or tag, bring the best row of each other face (up to
  // five) up behind it at a near-tie score, so the picture tiebreak
  // (lib/tiebreak.ts tiebreakIds) compares all the faces at once.
  // The "-1st" twin shares the face and is not a rival.
  const base = (id: string) => id.replace(/-1st$/, "");
  const top = scored[0];
  if (top) {
    const topKey = yugiohKey(top.row.collector_number);
    const faceOf = (r: TcgRow) => `${r.rarity}|${r.variant}`;
    const seen = new Set([faceOf(top.row)]);
    const rivals: typeof scored = [];
    for (const x of scored.slice(1)) {
      if (rivals.length === 5) break;
      if (base(x.row.id) === base(top.row.id) || yugiohKey(x.row.collector_number) !== topKey || seen.has(faceOf(x.row))) continue;
      seen.add(faceOf(x.row));
      rivals.push(x);
    }
    if (rivals.length) {
      const rest = scored.filter((x) => x !== top && !rivals.includes(x));
      // Re-sort after the lift: a better-scoring row from another set (the
      // real printing, code misread) must stay ahead of the lifted foils.
      const lifted = rivals.map((x) => ({ row: x.row, s: Math.min(x.s, top.s + TIEBREAK_GAP) }));
      scored.splice(0, scored.length, top, ...[...lifted, ...rest].sort((a, b) => a.s - b.s));
    }
  }
  return scored.slice(0, limit).map((x) => ({ ...toCard(x.row), rankScore: x.s }));
}
