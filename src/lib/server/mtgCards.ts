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

import { db } from "@/lib/db";
import type { ArtStyle, CardPrice, PokemonCard } from "@/lib/types";
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
  /** Joined from mtg_sets in the search queries; absent on the id fetch. */
  set_type?: string | null;
}

const CARD_COLUMNS = `id, name, set_code, set_name, collector_number, set_release_date,
                      image_url, rarity, type_line, finishes,
                      price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil`;

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
  };
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
): Promise<PokemonCard[]> {
  // Commas are punctuation, not identity: "Ragavan Nimble Pilferer" must
  // find "Ragavan, Nimble Pilferer".
  const needle = name.trim().toLowerCase().replace(/,/g, "");
  const wantedNumber = number ? normalizeCollectorNumber(number) : null;
  const wantedCode = setCode ? setCode.trim().toLowerCase() : null;

  let rows: MtgCardRow[];
  if (needle) {
    // Double-faced cards are stored as "Front // Back"; match either face.
    rows = (await db
      .prepare(
        `SELECT ${CARD_COLUMNS_JOINED}
           FROM mtg_cards c LEFT JOIN mtg_sets s ON s.code = c.set_code
          WHERE REPLACE(LOWER(c.name), ',', '') = ?
             OR REPLACE(LOWER(c.name), ',', '') LIKE ?
             OR REPLACE(LOWER(c.name), ',', '') LIKE ?
          ORDER BY c.set_release_date DESC
          LIMIT 600`,
      )
      .all(needle, `${needle}%`, `%${needle}%`)) as unknown as MtgCardRow[];
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

  if (rows.length === 0 && wantedNumber && wantedCode) {
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
  const score = (row: MtgCardRow): number => {
    const rowName = row.name.toLowerCase().replace(/,/g, "");
    const frontFace = rowName.split(" // ")[0];
    const exactName = needle !== "" && (rowName === needle || frontFace === needle);
    const prefixName = !exactName && needle !== "" && (wordPrefix(rowName) || wordPrefix(frontFace));
    const insideName = !exactName && !prefixName && needle !== "" && wordInside(rowName);
    const exactNumber = Boolean(wantedNumber) && normalizeCollectorNumber(row.collector_number) === wantedNumber;
    const codeAgrees = wantedCode ? row.set_code.toLowerCase() === wantedCode : null;

    let tier: number;
    if (exactName && exactNumber) tier = 0;
    else if (exactName) tier = 1;
    else if (prefixName) tier = 2;
    else if (insideName) tier = 3;
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
    return tier * NAME_TIER + codePenalty + pricePenalty + specialPenalty;
  };

  const ranked = rows
    .map((row) => ({ row, s: score(row) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.row);
  return ranked.map(toCard);
}

/** One row per set with a card in the mirror, newest first — for the sealed picker. */
export async function listMtgSets(): Promise<SetInfo[]> {
  const rows = (await db
    .prepare(
      `SELECT s.code, s.name, s.released_at, s.icon_url
         FROM mtg_sets s
        WHERE EXISTS (SELECT 1 FROM mtg_cards c WHERE c.set_code = s.code)
          AND (s.set_type NOT IN ('token', 'memorabilia', 'minigame', 'alchemy') OR s.name LIKE '%Art Series%')
        ORDER BY s.released_at DESC`,
    )
    .all()) as unknown as { code: string; name: string; released_at: string; icon_url: string }[];
  return rows.map((r) => ({ name: r.name, releaseDate: r.released_at, logoUrl: r.icon_url, code: r.code }));
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
      WHERE LOWER(name) = ? AND image_url <> '' AND price_usd IS NOT NULL
      ORDER BY price_usd DESC LIMIT 1`,
  );
  const out: PokemonCard[] = [];
  for (const n of names) {
    const row = (await stmt.get(n.toLowerCase())) as unknown as MtgCardRow | undefined;
    if (row) out.push(toCard(row));
    if (out.length >= limit) break;
  }
  return out;
}
