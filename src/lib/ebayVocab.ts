/**
 * The words eBay's Pokémon buyers search and filter on, derived from what we
 * know about a card. Shared by the listing title (lib/listing.ts) and the
 * item specifics (lib/ebayInventory.ts) so the two never disagree.
 *
 * Built 09-28 from ~40 recent sold listings (Harlequin 083/086, Umbreon ex
 * 161/131) and eBay's own filter sidebar for category 183454: Finish is
 * Holo / Reverse Holo / Regular / Foil; Features carries 1st Edition, Full
 * Art, Alternative Art; rarity words are "Special Illustration Rare", "Holo
 * Rare", "Ultra Rare" — never pokemontcg.io's "Rare Holo" order. Pure.
 */

import type { Condition } from "@/lib/types";

/** Condition as the big sellers abbreviate it at the end of a title. */
export const CONDITION_ABBREV: Record<Condition, string> = {
  "Near Mint": "NM",
  "Lightly Played": "LP",
  "Moderately Played": "MP",
  "Heavily Played": "HP",
  Damaged: "DMG",
};

/**
 * pokemontcg.io rarity → the eBay search word. Exact matches first; the
 * generic "Rare X" → "X Rare" flip covers the long tail ("Rare Shiny GX" →
 * "Shiny GX Rare" is close enough to how sellers write it). Unknown strings
 * pass through untouched; null stays null.
 */
const RARITY_WORD: Record<string, string> = {
  "Rare Holo": "Holo Rare",
  "Rare Holo EX": "Holo Rare",
  "Rare Holo GX": "Holo Rare",
  "Rare Holo V": "Holo Rare",
  "Rare Holo VMAX": "Holo Rare",
  "Rare Holo VSTAR": "Holo Rare",
  "Rare Holo LV.X": "Holo Rare",
  "Rare Holo Star": "Gold Star Holo Rare",
  "Rare Ultra": "Ultra Rare",
  "Rare Secret": "Secret Rare",
  "Rare Rainbow": "Rainbow Rare",
  "Rare Shiny": "Shiny Rare",
  "Rare Shining": "Shining Holo Rare",
  "Rare Prism Star": "Prism Star Holo Rare",
  "Rare BREAK": "BREAK Rare",
  "Rare Prime": "Prime Holo Rare",
  "Rare ACE": "ACE SPEC Rare",
  "Trainer Gallery Rare Holo": "Trainer Gallery Holo Rare",
  LEGEND: "LEGEND Holo Rare",
  "Classic Collection": "Classic Collection Holo",
};

export function ebayRarityWord(rarity: string | null | undefined): string | null {
  if (!rarity) return null;
  const clean = rarity.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (RARITY_WORD[clean]) return RARITY_WORD[clean];
  const flipped = /^Rare (.+)$/.exec(clean);
  if (flipped) return `${flipped[1]} Rare`;
  return clean;
}

/**
 * Whether the rarity alone says the card is a holo. Common / Uncommon /
 * Rare / Promo say nothing (those come in normal, reverse and holo prints);
 * everything else in the modern and WotC ladders is a foil card.
 */
export function rarityImpliesHolo(rarity: string | null | undefined): boolean {
  const word = ebayRarityWord(rarity);
  if (!word) return false;
  return !/^(Common|Uncommon|Rare|Promo|Black Star Promo)$/i.test(word);
}

export type PokemonPrinting = "normal" | "holo" | "reverse" | "pattern";

/**
 * Which kind of print a quote label names: "Holofoil" / "1st Ed. Holofoil"
 * / "Unlimited Holofoil" are holos, "Reverse Holofoil" is a reverse, the
 * Poké Ball / Master Ball patterns are their own thing (a reverse-style
 * foil buyers search by name), "Normal" / "Unlimited" / "1st Ed." are plain.
 * Anything else — eBay comps labels, "Average" — is unknown (null).
 */
export function classifyPrinting(label: string | null | undefined): PokemonPrinting | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (/^ebay\b|average/.test(l)) return null;
  if (/pattern/.test(l)) return "pattern";
  if (/reverse/.test(l)) return "reverse";
  if (/holo/.test(l)) return "holo";
  if (/^(normal|unlimited|1st ed\.?|1st edition)$/.test(l)) return "normal";
  return null;
}

/**
 * The printing as a title word, ASCII only ("Poke Ball Pattern" — sold
 * titles never carry the accent), with the edition words stripped because
 * 1st Edition already sits after the name. Null when there is nothing worth
 * saying: a plain print, or a holo the rarity already announces.
 */
export function titlePrintingWord(
  label: string | null | undefined,
  rarity: string | null | undefined,
): string | null {
  const kind = classifyPrinting(label);
  if (!kind || kind === "normal") return null;
  if (kind === "holo") return rarityImpliesHolo(rarity) || isPlainRarity(rarity) ? null : "Holo";
  if (kind === "reverse") return "Reverse Holo";
  return label!
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlainRarity(rarity: string | null | undefined): boolean {
  const word = ebayRarityWord(rarity);
  return !!word && /^(Common|Uncommon|Rare)$/i.test(word);
}

/**
 * The rarity word for the title. A holo or pattern print of a Common /
 * Uncommon / Rare reads "Holo Uncommon" — the sold listings' phrasing for
 * Poké Ball pattern Harlequin — so "Holo" lands in the title exactly once.
 */
export function titleRarityWord(
  rarity: string | null | undefined,
  label: string | null | undefined,
): string | null {
  const word = ebayRarityWord(rarity);
  if (!word) return null;
  const kind = classifyPrinting(label);
  if ((kind === "holo" || kind === "pattern") && isPlainRarity(rarity)) return `Holo ${word}`;
  return word;
}

/** eBay's Finish specific (category 183454 values): Holo, Reverse Holo, Regular. Null when unknown. */
export function ebayFinish(
  label: string | null | undefined,
  rarity: string | null | undefined,
): "Holo" | "Reverse Holo" | "Regular" | null {
  const kind = classifyPrinting(label);
  if (kind === "reverse") return "Reverse Holo";
  if (kind === "holo" || kind === "pattern") return "Holo";
  if (rarityImpliesHolo(rarity)) return "Holo";
  if (kind === "normal") return "Regular";
  return null;
}

/** eBay's Features specific values the rarity supports ("Full Art", "Alternative Art"). */
export function ebayFeatures(rarity: string | null | undefined): string[] {
  const word = ebayRarityWord(rarity);
  if (!word) return [];
  const out: string[] = [];
  if (/full art|illustration rare|ultra rare|hyper rare|rainbow rare|secret rare/i.test(word)) {
    out.push("Full Art");
  }
  if (/illustration rare|alt(ernate|ernative)? art|special art/i.test(word)) {
    out.push("Alternative Art");
  }
  return out;
}
