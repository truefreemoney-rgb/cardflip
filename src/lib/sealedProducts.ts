import type { GameId } from "@/lib/types";

/**
 * Sealed product price feed (Tier 2 #13, 09-27). TCGplayer lists a set's
 * booster boxes, ETBs, tins and blisters as products in the same group as
 * its cards, and tcgcsv republishes their market prices with the cards'.
 * These helpers are the pure half: naming a product's kind from its
 * TCGplayer title, and the series id a sealed row prices off.
 */

/**
 * The catalog id of a sealed product: the same string makeSealedProduct
 * gives the queue item and the ledger row stores as catalog_card_id, so a
 * price_series row under it is picked up by every consumer of
 * catalog_card_id (Inventory live refresh, alerts, digest, value chart)
 * with no sealed-specific branch anywhere.
 */
export function sealedProductId(game: GameId, setName: string, productType: string): string {
  return `sealed-${game}-${setName}-${productType}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Series id for one TCGplayer sealed product (the per-product line under the median). */
export function sealedTcgplayerId(productId: number): string {
  return `tcgp-sealed-${productId}`;
}

/** TCGplayer accessories and non-product rows that live in a set's group without being sealed product. */
const NOT_PRODUCT =
  /code card|art card|\bcoin\b|sleeves?\b|deck box|playmat|player'?s guide|display case|\bbulk\b|\bcase\b|\blot\b|energy card|damage counter|\bdice\b|binder(?! collection)|portfolio|\bpin\b|figure\b(?! collection)|plush|\bbadge\b|\bmat\b/i;

/**
 * Which of GAMES.pokemon.sealedProductTypes a TCGplayer product name is,
 * or null for accessories and shapes we do not sell as a type (booster
 * cases, Build & Battle Stadiums). Order matters: "Half Booster Box"
 * before "Booster Box", "Premium Collection" before "Collection".
 */
export function classifySealedProduct(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.replace(/\s+/g, " ").trim();
  if (NOT_PRODUCT.test(n)) return null;
  if (/elite trainer box|\bETB\b/i.test(n)) return "Elite Trainer Box";
  if (/half booster box/i.test(n)) return "Half Booster Box";
  if (/booster (box|display)/i.test(n)) return "Booster Box";
  if (/booster bundle/i.test(n)) return "Booster Bundle";
  if (/build (&|and) battle stadium/i.test(n)) return null;
  if (/build (&|and) battle|prerelease/i.test(n)) return "Build & Battle Box";
  if (/blister|checklane/i.test(n)) return "Blister Pack";
  if (/booster pack|sleeved booster|\bbooster\b$/i.test(n)) return "Booster Pack";
  if (/\btins?\b/i.test(n)) return "Tin";
  if (/ultra[- ]premium|premium collection|premium figure collection/i.test(n)) return "Premium Collection";
  if (/theme deck/i.test(n)) return "Theme Deck";
  if (/starter deck|battle deck|starter set|trainer kit|league battle/i.test(n)) return "Starter Deck";
  if (/collection|box set|special set|\bbox\b/i.test(n)) return "Collection Box";
  return null;
}

/**
 * What a product is beside its kind, judged from the real lists (09-27):
 * "lot" = a display, case, "[Set of 3]", "Mini Tins 5-Pack", art bundle or
 * Costco bundle — several units in one SKU, never a CardFlip listing (one
 * item per listing), so never stored. "exclusive" = a Pokémon Center /
 * retailer variant priced well above the plain product: listed for the
 * seller who has one, kept OUT of the set's kind median. "standard" is
 * the product the kind's price should mean.
 */
export type SealedRole = "standard" | "exclusive" | "lot";

const LOT = /\bdisplay\b|\bcase\b|set of \d|bundle of|art bundle|box bundle|\bcostco\b|tins? \d+[- ]pack|\d+[- ]pack\s*(\]|$)/i;
const EXCLUSIVE = /pok[eé]mon center|\bexclusive\b|sam'?s club|\bwalmart\b|\btarget\b|\bgamestop\b|best buy/i;

export function sealedProductRole(name: string | null | undefined): SealedRole {
  if (!name) return "standard";
  if (LOT.test(name)) return "lot";
  if (EXCLUSIVE.test(name)) return "exclusive";
  return "standard";
}

/** Middle value of the priced products of one kind in a set (two tins → their mean). */
export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  const m = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return Math.round(m * 100) / 100;
}
