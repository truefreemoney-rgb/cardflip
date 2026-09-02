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
import type { CardPrice, PokemonCard } from "@/lib/types";
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
}

const CARD_COLUMNS = `id, name, set_code, set_name, collector_number, set_release_date,
                      image_url, rarity, type_line, finishes,
                      price_usd, price_usd_foil, price_usd_etched, price_eur, price_eur_foil`;

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
        `SELECT ${CARD_COLUMNS}
           FROM mtg_cards
          WHERE REPLACE(LOWER(name), ',', '') = ?
             OR REPLACE(LOWER(name), ',', '') LIKE ?
             OR REPLACE(LOWER(name), ',', '') LIKE ?
          ORDER BY set_release_date DESC
          LIMIT 600`,
      )
      .all(needle, `${needle}%`, `%${needle}%`)) as unknown as MtgCardRow[];
  } else if (wantedNumber && wantedCode) {
    // No name but number + set code is itself an identification.
    rows = (await db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM mtg_cards
          WHERE LOWER(set_code) = ? AND LOWER(collector_number) = ?
          LIMIT 50`,
      )
      .all(wantedCode, wantedNumber)) as unknown as MtgCardRow[];
  } else {
    return [];
  }

  if (rows.length === 0 && wantedNumber && wantedCode) {
    rows = (await db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM mtg_cards
          WHERE LOWER(set_code) = ? AND LOWER(collector_number) = ?
          LIMIT 50`,
      )
      .all(wantedCode, wantedNumber)) as unknown as MtgCardRow[];
  }

  const score = (row: MtgCardRow): number => {
    const rowName = row.name.toLowerCase().replace(/,/g, "");
    const frontFace = rowName.split(" // ")[0];
    const exactName = needle !== "" && (rowName === needle || frontFace === needle);
    const prefixName = !exactName && needle !== "" && rowName.startsWith(needle);
    const exactNumber = Boolean(wantedNumber) && normalizeCollectorNumber(row.collector_number) === wantedNumber;
    const codeAgrees = wantedCode ? row.set_code.toLowerCase() === wantedCode : null;

    let tier: number;
    if (exactName && exactNumber) tier = 0;
    else if (exactName) tier = 1;
    else if (prefixName) tier = 2;
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
    return tier * NAME_TIER + codePenalty + pricePenalty;
  };

  const ranked = [...rows].sort((a, b) => score(a) - score(b)).slice(0, limit);
  return ranked.map(toCard);
}

/** One row per set with a card in the mirror, newest first — for the sealed picker. */
export async function listMtgSets(): Promise<SetInfo[]> {
  const rows = (await db
    .prepare(
      `SELECT s.code, s.name, s.released_at, s.icon_url
         FROM mtg_sets s
        WHERE EXISTS (SELECT 1 FROM mtg_cards c WHERE c.set_code = s.code)
          AND s.set_type NOT IN ('token', 'memorabilia', 'minigame', 'alchemy')
        ORDER BY s.released_at DESC`,
    )
    .all()) as unknown as { code: string; name: string; released_at: string; icon_url: string }[];
  return rows.map((r) => ({ name: r.name, releaseDate: r.released_at, logoUrl: r.icon_url, code: r.code }));
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
