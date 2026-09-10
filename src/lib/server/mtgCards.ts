/**
 * Magic: The Gathering identification + pricing, served from the local
 * Scryfall mirror (mtg_cards / mtg_sets — scripts/sync-mtg.mjs).
 *
 * Same idea as enCards.ts for Pokémon: rank by name first (the field a scan
 * gets right most often), then by collector number, then by set code. MTG
 * makes this easier than Pokémon in one way — the set code is printed on
 * every modern card next to the number ("0187/0281 R  LTR • EN") and is
 * unique per set — and harder in another: the same name is reprinted across
 * dozens of sets, so name alone is never enough to price a card.
 *
 * Prices come from the mirror row (Scryfall's per-printing USD nonfoil /
 * foil / etched + EUR), refreshed each sync, mapped onto CardPrice with the
 * finish as the variant so the editor's variant picker becomes the foil
 * picker.
 */

import { cachedList, SET_LIST_TTL_MS } from "@/lib/server/listCache";
import { db } from "@/lib/db";
import type { ArtStyle, CardPrice, MtgCues, MtgMark, PokemonCard } from "@/lib/types";
import type { SetInfo } from "@/lib/grading";
import { MTG_FINISH_LABEL } from "@/lib/games";

interface MtgCardRow {
  id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  set_release_date: string;
  image_url: string;
  rarity: string;
  type_line: string;
  finishes: string;
  price_usd: number | null;
  price_usd_foil: number | null;
  price_usd_etched: number | null;
  price_eur: number | null;
  price_eur_foil: number | null;
  // Printing cues (09-10): '' / 0 on rows synced before they existed.
  artist: string;
  frame: string;
  border_color: string;
  frame_effects: string;
  promo_types: string;
  full_art: number;
  textless: number;
  /** Scryfall flavor_name: LTC 386 "Shards of Narsil" is Thorn of Amethyst; '' on most rows. */
  flavor_name: string;
  /** Joined from mtg_sets in the search queries; absent on the id fetch. */
  set_type?: string | null;
}

const CARD_COLUMNS = `id, name, set_code, set_name, collector_number, set_release_date,
                      image_url, rarity, type_line, finishes,
                      price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil,
                      artist, frame, border_color, frame_effects, promo_types, full_art, textless, flavor_name`;

/** The same columns off a `c` alias, plus the set's type — for the ranked
 * searches, which join mtg_sets (both tables have a `name` column). */
const CARD_COLUMNS_JOINED = `${CARD_COLUMNS.split(",").map((col) => `c.${col.trim()}`).join(", ")}, s.set_type`;

/**
 * Set types whose printings are special treatments — Mystical Archive
 * (masterpiece), Secret Lair (box), promos — rather than the plain card a
 * seller most likely photographed. With no printed evidence pointing at one
 * (no agreeing set code, no matching collector number, no special frame seen),
 * these rank below normal printings: 09-02, a plain M11 Pyretic Ritual matched
 * the 2026 Mystical Archive showcase purely because the no-evidence tie broke
 * newest-first.
 */
const SPECIAL_SET_TYPES = new Set(["masterpiece", "box", "promo", "memorabilia", "funny", "token", "minigame", "alchemy"]);

/** Sets that are special by code, not type: The List rides set_type "masters"
 * but is a Set Booster insert whose collector numbers ("M11-153") aren't even
 * what's printed on the card, so it can never out-rank a real printing
 * without evidence (and evidence can't point at it). */
const SPECIAL_SET_CODES = new Set(["plst"]);

function pricesOf(row: MtgCardRow): CardPrice[] {
  const out: CardPrice[] = [];
  const push = (variant: string, currency: "USD" | "EUR", value: number | null, source: CardPrice["source"]) => {
    if (value == null || !(value > 0)) return;
    out.push({
      source,
      variant,
      label: MTG_FINISH_LABEL[variant] ?? variant,
      currency,
      market: value,
      low: null,
      high: null,
    });
  };
  // Scryfall's USD figures are TCGplayer market prices, EUR are Cardmarket.
  push("nonfoil", "USD", row.price_usd, "tcgplayer");
  push("foil", "USD", row.price_usd_foil, "tcgplayer");
  push("etched", "USD", row.price_usd_etched, "tcgplayer");
  push("nonfoil", "EUR", row.price_eur, "cardmarket");
  push("foil", "EUR", row.price_eur_foil, "cardmarket");
  return out;
}

/** Scryfall image URLs carry the size in the path (.../normal/front/...). */
function largeImage(url: string): string {
  return url.replace("/normal/", "/large/");
}

function toCard(row: MtgCardRow): PokemonCard {
  return {
    id: row.id,
    name: row.name,
    setName: row.set_name,
    setSeries: "",
    number: row.collector_number,
    rarity: row.rarity ? row.rarity[0].toUpperCase() + row.rarity.slice(1) : null,
    imageSmall: row.image_url,
    imageLarge: largeImage(row.image_url),
    prices: pricesOf(row),
    englishName: null,
    setTotal: null,
    setCode: row.set_code ? row.set_code.toUpperCase() : null,
    isSecretRare: false,
    game: "mtg",
    typeLine: row.type_line || null,
    finishes: row.finishes ? row.finishes.split(",").filter(Boolean) : [],
    artist: row.artist || null,
    frame: row.frame || null,
    borderColor: row.border_color || null,
    frameEffects: row.frame_effects ? row.frame_effects.split(",").filter(Boolean) : [],
    promoTypes: row.promo_types ? row.promo_types.split(",").filter(Boolean) : [],
    fullArt: Boolean(row.full_art),
    textless: Boolean(row.textless),
  };
}

/** Sets that reprint a card exactly as it was — original set symbol, set
 * code and copyright line — and mark it only with a small icon (The List's
 * planeswalker symbol) or nothing at all (Mystery Booster). The copyright
 * year on the card is the ORIGINAL's, so the year cue must not count. */
const AS_IS_REPRINT_SETS = new Set(["plst", "mb1", "mb2", "cmb1", "cmb2"]);

/** Artist names fold to letters only: "Raymond Swanland" = "raymond swanland" = OCR's "Raymond  Swanland". */
const foldArtist = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Levenshtein distance, capped at 3 — only "close enough" matters here. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.min(prev[b.length], 3);
}

/**
 * How badly a printing disagrees with what the scan saw beyond name /
 * number / set code (docs/MTG-IDENTIFICATION.md, phase 1). Every cue is a
 * small, bounded penalty: less than a set-code disagreement (9) or a name
 * tier (8), so a misread cue can never outvote the printed key — it only
 * breaks the ties the key leaves, which is exactly where the coin flips
 * were. A cue the scan didn't read costs nothing. A row synced before the
 * cue columns existed ('' everywhere) is treated as unknown, not wrong.
 */
export function cuePenalty(row: MtgCardRow, cues: MtgCues | null | undefined): number {
  const known = row.frame !== "" || row.border_color !== "";
  let p = 0;
  const effects = row.frame_effects ? row.frame_effects.split(",") : [];
  const promos = row.promo_types ? row.promo_types.split(",") : [];
  const releaseYear = Number(row.set_release_date.slice(0, 4)) || 0;
  const showcase = effects.includes("showcase");
  const extended = effects.includes("extendedart");
  const borderless = row.border_color === "borderless";
  const retro = (row.frame === "1993" || row.frame === "1997") && releaseYear >= 2015;
  const special = showcase || extended || borderless || retro || Boolean(row.full_art) || Boolean(row.textless);

  // No treatment read at all: the plain printing is the likelier one in the
  // photo (a nudge, not a vote — prod 09-10 broke a Sheoldred DMU name+code
  // tie onto the borderless #435 by row order).
  if (!cues?.treatment && known && special) p += 0.25;
  if (!cues) return p;

  // Frame treatment ↔ Scryfall frame_effects / border / full_art / textless.
  if (cues.treatment && known) {
    const agrees =
      cues.treatment === "standard" ? !special
      : cues.treatment === "showcase" ? showcase
      : cues.treatment === "extended-art" ? extended
      : cues.treatment === "borderless" ? borderless
      : cues.treatment === "retro" ? retro
      : cues.treatment === "full-art" ? Boolean(row.full_art) || borderless
      : cues.treatment === "textless" ? Boolean(row.textless)
      : true;
    if (!agrees) p += 3;
  }

  // Printed marks ↔ promo types / The List. A seen mark that the row lacks
  // and a row that carries a mark the scan didn't see both cost.
  const marks = new Set(cues.marks ?? []);
  const isList = row.set_code.toLowerCase() === "plst";
  const number = row.collector_number.toLowerCase();
  const rowMarks = {
    "list-icon": isList,
    "promo-stamp": promos.includes("promopack") || /\dp$/.test(number),
    "date-stamp": promos.includes("prerelease") || promos.includes("datestamped") || /\ds$/.test(number),
    serialized: promos.includes("serialized"),
  } as const;
  for (const [mark, rowHas] of Object.entries(rowMarks)) {
    const seen = marks.has(mark as MtgMark);
    if (seen && !rowHas) p += 3;
    // Only rows with cue data can be blamed for carrying an unseen mark;
    // The List is known from the set code alone.
    if (!seen && rowHas && (known || mark === "list-icon") && (cues.marks !== undefined)) {
      // A List row with the corner unchecked / unsure costs one (a near-tie
      // for the picture tiebreak); with the corner seen empty it costs three.
      p += mark === "list-icon" && cues.listIconSeen !== false ? 1 : 3;
    }
  }

  // Artist: same art across reprints shares the credit, so this separates
  // different-art printings only — which is the case that needs it.
  if (cues.artist && row.artist) {
    const a = foldArtist(cues.artist), b = foldArtist(row.artist);
    // One or two letters off is a misread ("Douglas Schuler" for Shuler,
    // 09-10 panel), not a different artist.
    if (a.length >= 4 && b.length >= 4 && a !== b && !a.includes(b) && !b.includes(a) && editDistance(a, b) > 2) p += 4;
  }

  // Copyright year is the printing year. ±1 covers a set printed in
  // December for a January release.
  if (cues.copyrightYear && releaseYear && !AS_IS_REPRINT_SETS.has(row.set_code.toLowerCase())) {
    const gap = Math.abs(cues.copyrightYear - releaseYear);
    if (gap > 1) p += 3;
    // A one-year gap is possible but a same-year set is the better answer:
    // Summer Magic (1994) vs 4th Edition (1995) on a "© 1994" read (09-10 panel).
    else if (gap === 1) p += 1;
    // Cards before 4th Edition / Ice Age (April 1995) print no year at all,
    // so a read year rules those sets out outright (Beta, Unlimited,
    // Revised, Arabian Nights … Fallen Empires).
    // Summer Magic (June 1994) is the famous exception: it prints "© 1994".
    if (row.set_release_date < "1995-04-01" && row.set_code.toLowerCase() !== "sum") p += 3;
  }

  // Border colour, when the row knows its own and it isn't the borderless
  // case (treatment already covers that).
  if (cues.border && cues.border !== "borderless" && row.border_color && row.border_color !== "borderless") {
    if (cues.border !== row.border_color) p += 3;
  }

  // Second-look cues for the 1990s white-border ladder (09-10 panel):
  // a readable bottom strip with NO year line means a pre-April-1995 card,
  // so 4th Edition and later lose two; the Unlimited bevel (a dark inner
  // line where the white border meets the frame) separates Unlimited from
  // the flat-bordered Revised / Summer / 4th / 5th.
  // (Summer Magic prints © 1994, so "no year line" rules it out as well — it
  // must never win a white-border tie by being the newest no-year set.)
  if (cues.noYearLine && (row.set_release_date >= "1995-04-01" || row.set_code.toLowerCase() === "sum") && !AS_IS_REPRINT_SETS.has(row.set_code.toLowerCase())) p += 2;
  // Only a SEEN bevel counts: on the 09-10 panel the close-up answered
  // "false" on every Unlimited scan, so an absent bevel is no evidence.
  if (cues.bevel === true && row.border_color === "white" && releaseYear && releaseYear < 1998) {
    const code = row.set_code.toLowerCase();
    if (code === "3ed" || code === "sum" || code === "4ed" || code === "5ed") p += 2;
  }
  return p;
}

/** "0187" and "187" are the same collector number; suffix letters/★ stay. */
export function normalizeCollectorNumber(value: string): string {
  return value.trim().toLowerCase().replace(/^0+(?=\d)/, "");
}

const NAME_TIER = 8;

/**
 * Cards a scan / search could be, best first. `number` and `setCode` come
 * from vision (or the typed query); either can be null.
 */
/** Exact catalog-id fetch — mirror prices included, no name walk. */
export async function mtgCardById(id: string): Promise<PokemonCard[]> {
  const row = (await db
    .prepare(`SELECT ${CARD_COLUMNS} FROM mtg_cards WHERE id = ?`)
    .get(id)) as MtgCardRow | undefined;
  return row ? [toCard(row)] : [];
}

export async function searchMtgCardsLocal(
  name: string,
  number: string | null,
  setCode: string | null,
  limit = 24,
  art: ArtStyle = null,
  /** Vision saw an Art Series card: only art sets may answer (09-03). */
  artOnly = false,
  /** Everything else the scan read (finish, treatment, marks, artist, year, border). */
  cues: MtgCues | null = null,
): Promise<PokemonCard[]> {
  // Commas are punctuation, not identity: "Ragavan Nimble Pilferer" must
  // find "Ragavan, Nimble Pilferer".
  const needle = name.trim().toLowerCase().replace(/,/g, "");
  const wantedNumber = number ? normalizeCollectorNumber(number) : null;
  const wantedCode = setCode ? setCode.trim().toLowerCase() : null;

  let rows: MtgCardRow[];
  if (needle) {
    // Double-faced cards are stored as "Front // Back"; match either face.
    // Exact + prefix as one range on idx_mtg_cards_folded (expression index on
    // the comma-less lowercase name) — a SEARCH, not a 94k-row walk. The
    // substring tier is the full walk, so it runs only when the range finds
    // nothing (outage 09-06: this query scanned the mirror on every search).
    rows = (await db
      .prepare(
        `SELECT ${CARD_COLUMNS_JOINED}
           FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
          WHERE REPLACE(LOWER(c.name), ',', '') >= ? AND REPLACE(LOWER(c.name), ',', '') < ?
          ORDER BY c.set_release_date DESC
          LIMIT 600`,
      )
      .all(needle, `${needle}\uffff`)) as unknown as MtgCardRow[];
    // A flavor name is what the photo says (LTC 386 "Shards of Narsil" is
    // Thorn of Amethyst; the Universes Beyond twins) \u2014 the catalog name is on
    // the row, not the card. Partial index on the folded flavor_name.
    const flavored = (await db
      .prepare(
        `SELECT ${CARD_COLUMNS_JOINED}
           FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
          WHERE c.flavor_name <> ''
            AND REPLACE(LOWER(c.flavor_name), ',', '') >= ? AND REPLACE(LOWER(c.flavor_name), ',', '') < ?
          ORDER BY c.set_release_date DESC
          LIMIT 100`,
      )
      .all(needle, `${needle}\uffff`)) as unknown as MtgCardRow[];
    if (flavored.length) {
      const seen = new Set(rows.map((r) => r.id));
      for (const r of flavored) if (!seen.has(r.id)) rows.push(r);
    }
    // 600 newest printings is the whole story for most names, but a basic
    // land or a 1990s card has more — the printing in the photo can sit past
    // the cap. When the scan read a copyright year, add that year's window
    // (phase 2 panel: a 1999 Plains and a Tempest Swamp never made the list).
    const year = cues?.copyrightYear;
    // "No year line" (second look, 09-10) means a pre-April-1995 card: open
    // the 1993–1995 window the same way (an Unlimited Mountain sat past 600
    // Mountains and a Secret Lair one won).
    const window = year ? [`${year - 1}-01-01`, `${year + 2}-01-01`] : cues?.noYearLine ? ["1993-01-01", "1995-04-01"] : null;
    if (rows.length >= 600 && window) {
      const older = (await db
        .prepare(
          `SELECT ${CARD_COLUMNS_JOINED}
             FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
            WHERE REPLACE(LOWER(c.name), ',', '') >= ? AND REPLACE(LOWER(c.name), ',', '') < ?
              AND c.set_release_date >= ? AND c.set_release_date < ?
            LIMIT 200`,
        )
        .all(needle, `${needle}￿`, window[0], window[1])) as unknown as MtgCardRow[];
      const seen = new Set(rows.map((r) => r.id));
      for (const r of older) if (!seen.has(r.id)) rows.push(r);
    }
    if (rows.length === 0 && needle.length >= 5) {
      rows = (await db
        .prepare(
          `SELECT ${CARD_COLUMNS_JOINED}
             FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
            WHERE REPLACE(LOWER(c.name), ',', '') LIKE ?
            ORDER BY c.set_release_date DESC
            LIMIT 600`,
        )
        .all(`%${needle}%`)) as unknown as MtgCardRow[];
    }
  } else if (wantedNumber && wantedCode) {
    // No name but number + set code is itself an identification.
    rows = (await db
      .prepare(
        `SELECT ${CARD_COLUMNS_JOINED}
           FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
          WHERE LOWER(c.set_code) = ? AND LOWER(c.collector_number) = ?
          LIMIT 50`,
      )
      .all(wantedCode, wantedNumber)) as unknown as MtgCardRow[];
  } else {
    return [];
  }

  // The name read matched nothing, but number + set code is a printing on
  // its own. Those rows must survive the name gate below (09-06: a misread
  // name with a perfect "0066 SPM" came back "no match" because every
  // by-number row scored Infinity — the fallback was dead code).
  let nameMisread = false;
  if (rows.length === 0 && wantedNumber && wantedCode) {
    nameMisread = true;
    rows = (await db
      .prepare(
        `SELECT ${CARD_COLUMNS_JOINED}
           FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
          WHERE LOWER(c.set_code) = ? AND LOWER(c.collector_number) = ?
          LIMIT 50`,
      )
      .all(wantedCode, wantedNumber)) as unknown as MtgCardRow[];
  }

  // A name match has to end on a word boundary: "Hero" is not a prefix of
  // "Heroic Return" and "Bird" is not inside "Birds of Paradise". Chris's
  // 09-03 MTG stress test: Final Fantasy TOKENS (Hero, Bird — not in the
  // mirror) rode those substrings onto priced Marvel cards. Substring
  // matches also need a real word (5+ chars) — three letters of OCR debris
  // match half the catalogue.
  const boundary = (text: string, at: number) => at >= text.length || /[\s,'’\-:]/.test(text[at]);
  const wordPrefix = (text: string) => text.startsWith(needle) && boundary(text, needle.length);
  const wordInside = (text: string) => {
    if (needle.length < 5) return false;
    let from = 0;
    for (;;) {
      const i = text.indexOf(needle, from);
      if (i < 0) return false;
      if ((i === 0 || /[\s,'’\-:]/.test(text[i - 1])) && boundary(text, i + needle.length)) return true;
      from = i + 1;
    }
  };
  const listSeen = Boolean(cues?.marks?.includes("list-icon"));
  // Icon not seen but not ruled out either (the close-up answered null, or
  // never looked): the List twin stays on the printed key one point behind
  // the original, which makes it a near-tie — and the picture tiebreak, not
  // row order, settles it (09-10: three List cards at 672px).
  const listMaybe = !listSeen && cues?.marks !== undefined && cues?.listIconSeen !== false;
  // A stamped card prints its ORIGINAL code + number; Scryfall files it as
  // "268p" in set "PDFT" (promo pack), "198s" / "51★" in "PDFT" / "PJOU"
  // (prerelease), or "141z" in the same set (serialized). With the mark in
  // the photo, that suffixed row is the printed key — without this the base
  // printing won every one of the 21 stamped cards on the phase 2 panel.
  const marks = new Set(cues?.marks ?? []);
  const stampSuffix = marks.has("promo-stamp") ? /p$/ : marks.has("date-stamp") ? /[s★]$/ : marks.has("serialized") ? /z$/ : null;
  const score = (row: MtgCardRow): number => {
    const rowName = row.name.toLowerCase().replace(/,/g, "");
    // A List row's "M11-153" is the original's code + number; with the icon
    // in the photo, that IS the printed key.
    // (Vision sometimes reports the List's own code, "PLST", with the bare
    // original number — then any PLST row ending in that number is the key.)
    const listTwin = (listSeen || listMaybe) && row.set_code.toLowerCase() === "plst" && wantedCode
      ? wantedCode === "plst"
        ? wantedNumber !== null && row.collector_number.toLowerCase().endsWith(`-${wantedNumber}`)
        : row.collector_number.toLowerCase().startsWith(`${wantedCode}-`)
      : false;
    const rawCode = row.set_code.toLowerCase();
    const stampTwin =
      Boolean(stampSuffix) && wantedNumber !== null && stampSuffix!.test(row.collector_number) &&
      (wantedCode === null || rawCode === wantedCode || rawCode === `p${wantedCode}`);
    const rowCode = listTwin || (stampTwin && wantedCode) ? wantedCode! : rawCode;
    const rowNumber = listTwin
      ? row.collector_number.slice(row.collector_number.indexOf("-") + 1)
      : stampTwin
        ? row.collector_number.replace(stampSuffix!, "")
        : row.collector_number;
    const frontFace = rowName.split(" // ")[0];
    const flavor = (row.flavor_name ?? "").toLowerCase().replace(/,/g, "");
    const exactName = needle !== "" && (rowName === needle || frontFace === needle || (flavor !== "" && flavor === needle));
    const prefixName = !exactName && needle !== "" && (wordPrefix(rowName) || wordPrefix(frontFace) || (flavor !== "" && wordPrefix(flavor)));
    const insideName = !exactName && !prefixName && needle !== "" && wordInside(rowName);
    const exactNumber = Boolean(wantedNumber) && normalizeCollectorNumber(rowNumber) === wantedNumber;
    const codeAgrees = wantedCode ? rowCode === wantedCode : null;

    let tier: number;
    if (exactName && exactNumber) tier = 0;
    else if (exactName) tier = 1;
    else if (prefixName) tier = 2;
    else if (insideName) tier = 3;
    else if (nameMisread && exactNumber && codeAgrees === true) tier = 3; // number + set carry a misread name
    else if (needle !== "") return Infinity; // name read, and this row's name isn't it
    else if (exactNumber) tier = 3;
    else tier = 4;

    // Set code is decisive when we have one: same name + number + code is a
    // single printing. A mismatch costs more than a whole name tier, so an
    // exact name in the RIGHT set (8) beats an exact name + number in the
    // wrong set (0 + 9) — a misread digit is likelier than a misread code.
    const codePenalty = codeAgrees === null ? 1 : codeAgrees ? 0 : 9;
    // Prefer printings that have a price at all (a priced row is a real,
    // buyable printing; unpriced ones are usually oddities).
    const pricePenalty = row.price_usd == null && row.price_usd_foil == null ? 0.5 : 0;
    // Special treatments (Mystical Archive, Secret Lair, promos) only win on
    // evidence: an agreeing set code or collector number, or vision seeing a
    // special frame. Otherwise the plain printing is what's in the photo.
    const specialPenalty =
      (SPECIAL_SET_TYPES.has(row.set_type ?? "") || SPECIAL_SET_CODES.has(row.set_code.toLowerCase())) &&
      art !== "full-art" &&
      codeAgrees !== true &&
      !exactNumber
        ? 2
        : 0;
    return tier * NAME_TIER + codePenalty + pricePenalty + specialPenalty + cuePenalty(row, cues);
  };

  // Art Series rows answer only an Art Series read: they carry no frame data,
  // so they dodged every cue penalty and won name-only ties (phase 2 panel:
  // a Tempest Swamp lost to the Art Series Swamp).
  // By set name OR by the card's own type line ("Card", "Card // Card"): the
  // Tales of Middle-earth art cards live in a set called "Scene Box" (09-10).
  const isArtSeries = (row: MtgCardRow) =>
    row.set_type === "memorabilia" && (/art series/i.test(row.set_name) || /^card\b/i.test(row.type_line ?? ""));
  rows = rows.filter((row) => isArtSeries(row) === artOnly);
  const ranked = rows
    .map((row) => ({ row, s: score(row) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => a.s - b.s)
    .slice(0, limit);
  // rankScore rides along so the scanner can see a near-tie between #1 and
  // #2 and send the photo to the picture tiebreak (vision.ts, 09-10).
  return ranked.map((x) => ({ ...toCard(x.row), rankScore: x.s }));
}

/** One row per set with a card in the mirror, newest first — for the sealed picker. */
export async function listMtgSets(): Promise<SetInfo[]> {
  // Memoed: the DISTINCT walks the whole set_code index (~94k rows) and Turso
  // bills every one (outage 09-06). One walk per six hours, not per picker.
  return cachedList("sets:v1:mtg", SET_LIST_TTL_MS, async () => {
    const rows = (await db
      .prepare(
        `SELECT s.code, s.name, s.released_at, s.icon_url
           FROM mtg_sets s
          WHERE s.code IN (SELECT DISTINCT set_code FROM mtg_cards)
            AND (s.set_type NOT IN ('token', 'memorabilia', 'minigame', 'alchemy') OR s.name LIKE '%Art Series%')
          ORDER BY s.released_at DESC`,
      )
      .all()) as unknown as { code: string; name: string; released_at: string; icon_url: string }[];
    return rows.map((r) => ({ name: r.name, releaseDate: r.released_at, logoUrl: r.icon_url, code: r.code }));
  });
}

/** Every printing in one set, in collector-number order — the set browser. */
export async function mtgCardsBySet(setCode: string): Promise<PokemonCard[]> {
  const rows = (await db
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM mtg_cards
        WHERE set_code = ?
        ORDER BY CAST(collector_number AS INTEGER), collector_number`,
    )
    .all(setCode.toLowerCase())) as unknown as MtgCardRow[];
  return rows.map(toCard);
}

/** True once scripts/sync-mtg.mjs has populated the mirror. */
/**
 * Whether The List reprinted this exact printing (PLST files it as
 * "<SET>-<number>"). When it did, the scan's second look checks the
 * bottom-left corner for the List icon before the ranker chooses.
 */
export async function hasListTwin(setCode: string, number: string): Promise<boolean> {
  return (await hasTwinPrinting(setCode, number)) === "list";
}

/**
 * Whether this printed key (set code + number) has a look-alike twin that
 * only a corner mark tells apart: The List reprint ("<SET>-<n>" in PLST), a
 * prerelease date stamp ("<n>s" in P<SET>), a promo-pack stamp ("<n>p"), or
 * a serialized copy ("<n>z"). The scan's second look fires on these.
 */
export async function hasTwinPrinting(setCode: string, number: string): Promise<"list" | "prerelease" | "promo" | "serialized" | null> {
  const code = setCode.toLowerCase();
  try {
    const rows = (await db
      .prepare(
        `SELECT set_code, collector_number FROM mtg_cards
          WHERE (set_code = 'plst' AND collector_number = ?)
             OR (set_code IN (?, ?) AND collector_number IN (?, ?, ?))
          LIMIT 4`,
      )
      .all(`${setCode.toUpperCase()}-${number}`, code, `p${code}`, `${number}s`, `${number}p`, `${number}z`)) as unknown as Array<{ set_code: string; collector_number: string }>;
    for (const r of rows) {
      if (r.set_code === "plst") return "list";
      if (r.collector_number.endsWith("s")) return "prerelease";
      if (r.collector_number.endsWith("p")) return "promo";
      if (r.collector_number.endsWith("z")) return "serialized";
    }
    return null;
  } catch {
    return null;
  }
}

export async function hasMtgMirror(): Promise<boolean> {
  try {
    const row = (await db.prepare("SELECT 1 AS ok FROM mtg_cards LIMIT 1").get()) as { ok: number } | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

/** A handful of iconic, priced cards for the landing showcase. */
export async function mtgShowcase(limit = 12): Promise<PokemonCard[]> {
  const names = [
    "Black Lotus",
    "Ragavan, Nimble Pilferer",
    "Sheoldred, the Apocalypse",
    "The One Ring",
    "Force of Will",
    "Lightning Bolt",
    "Jace, the Mind Sculptor",
    "Sol Ring",
    "Atraxa, Grand Unifier",
    "Mana Crypt",
    "Liliana of the Veil",
    "Teferi, Time Raveler",
  ];
  const stmt = db.prepare(
    `SELECT ${CARD_COLUMNS} FROM mtg_cards
      WHERE REPLACE(LOWER(name), ',', '') = ? AND image_url <> '' AND price_usd IS NOT NULL
      ORDER BY price_usd DESC LIMIT 1`,
  );
  // The comma-stripped expression is what idx_mtg_cards_folded indexes; a
  // plain LOWER(name) = ? walked all 94k rows twelve times per showcase.
  const out: PokemonCard[] = [];
  for (const n of names) {
    const row = (await stmt.get(n.toLowerCase().replace(/,/g, ""))) as unknown as MtgCardRow | undefined;
    if (row) out.push(toCard(row));
    if (out.length >= limit) break;
  }
  return out;
}
