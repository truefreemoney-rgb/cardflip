/**
 * PriceCharting price guide (built 10-18, before the subscription: docs/PRICE-FALLBACK-PLAN.md,
 * memory "PriceCharting FINALE"). Their nightly CSV (Legendary plan, one download per category,
 * regenerated every 24 h, at most one CSV call per 10 minutes) has one row per product; column
 * names = the Prices API keys (pricecharting.com/api-documentation):
 *   id, console-name ("Pokemon Base Set"), product-name ("Charizard [1st Edition] #4"),
 *   loose-price (cards: UNGRADED, USD with two decimals in the CSV), graded-price (grade 9),
 *   manual-only-price (PSA 10), sales-volume (units sold in a year), tcg-id (TCGplayer product id),
 *   release-date.
 * The API returns prices as integer pennies instead; both are handled.
 * Pure: parsing only. Licence: internal use + Chris's display permission until $1,000/month
 * revenue; attribution = a text link to https://www.pricecharting.com/game/<id>. All stored data
 * must be purged if the subscription ends.
 */

export interface PcProduct {
  id: string;
  console: string;
  name: string;
  /** Ungraded price in USD, or null when PriceCharting has none. */
  loose: number | null;
  /** Grade 9 and PSA 10 prices in USD (null when absent). */
  graded9: number | null;
  psa10: number | null;
  /** Units sold in the last year (PriceCharting's "sales-volume"), 0 when absent. */
  salesVolume: number;
  /** TCGplayer product id, or null. */
  tcgId: string | null;
  releaseDate: string | null;
}

/** RFC 4180 CSV: commas, double-quoted fields with "" escapes, CRLF or LF rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/** A CSV price cell ("$1,234.56", "1234.56", "") in USD, or null. */
export function csvUsd(cell: string | undefined): number | null {
  if (cell == null) return null;
  const v = Number(cell.replace(/[$,\s]/g, ""));
  return cell.trim() !== "" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

/** An API price (integer pennies) in USD, or null. */
export const apiUsd = (pennies: unknown): number | null => (typeof pennies === "number" && pennies > 0 ? Math.round(pennies) / 100 : null);

/** Every product of a price-guide CSV. Throws when the header lacks the columns we need. */
export function readPriceGuide(text: string): PcProduct[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const col = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  for (const need of ["id", "product-name", "loose-price"]) if (!col.has(need)) throw new Error(`PriceCharting CSV: no "${need}" column (got ${header.join(", ")})`);
  const get = (r: string[], k: string) => {
    const i = col.get(k);
    return i == null ? "" : (r[i] ?? "").trim();
  };
  const out: PcProduct[] = [];
  for (const r of rows) {
    const id = get(r, "id");
    if (!id) continue;
    const tcg = get(r, "tcg-id");
    out.push({
      id,
      console: get(r, "console-name"),
      name: get(r, "product-name"),
      loose: csvUsd(get(r, "loose-price")),
      graded9: csvUsd(get(r, "graded-price")),
      psa10: csvUsd(get(r, "manual-only-price")),
      salesVolume: Math.max(0, Math.round(Number(get(r, "sales-volume").replace(/,/g, "")) || 0)),
      tcgId: /^\d+$/.test(tcg) ? tcg : null,
      releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(get(r, "release-date")) ? get(r, "release-date") : null,
    });
  }
  return out;
}

/** One /api/product response as a PcProduct (prices in pennies there). */
export function fromApi(j: Record<string, unknown>): PcProduct | null {
  if (j.status !== "success" || j.id == null) return null;
  const tcg = j["tcg-id"] == null ? "" : String(j["tcg-id"]);
  return {
    id: String(j.id),
    console: String(j["console-name"] ?? ""),
    name: String(j["product-name"] ?? ""),
    loose: apiUsd(j["loose-price"]),
    graded9: apiUsd(j["graded-price"]),
    psa10: apiUsd(j["manual-only-price"]),
    salesVolume: Math.max(0, Math.round(Number(j["sales-volume"]) || 0)),
    tcgId: /^\d+$/.test(tcg) ? tcg : null,
    releaseDate: typeof j["release-date"] === "string" ? (j["release-date"] as string) : null,
  };
}

export interface PcName {
  /** The card name without brackets or number ("Charizard"). */
  base: string;
  /** Bracketed tags, as written ("1st Edition", "Reverse Holo", "Poke Ball"). */
  tags: string[];
  /** The collector number after "#", or null. */
  number: string | null;
}

/** "Charizard [1st Edition] #4" -> { base: "Charizard", tags: ["1st Edition"], number: "4" }. */
export function parseProductName(name: string): PcName {
  const tags = [...name.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  const num = name.match(/#\s*([A-Za-z0-9-]+)\s*$/);
  const base = name
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/#\s*[A-Za-z0-9-]+\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { base, tags, number: num ? num[1] : null };
}

/** The product page PriceCharting asks us to link to (attribution). */
export const pcProductUrl = (id: string) => `https://www.pricecharting.com/game/${encodeURIComponent(id)}`;

/** Lower-case tags with spaces/dashes folded, for matching ("Reverse Holo" -> "reverseholo"). */
export const tagKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------------------
// Matching PriceCharting products to our printings (card id + price variant).
// PriceCharting has one product per printing (a "[Reverse Holo]" row next to the plain one) where TCGplayer has one
// product with subtypes, so the product's tcg-id gives the card and its bracket tags give the variant. A row is only
// written onto a variant the card already has a TCGplayer series for (or a 1st Edition twin that exists): anything
// unsure is skipped and counted, never guessed.

export type PcGame = "pokemon" | "mtg" | "yugioh" | "lorcana" | "onepiece";

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

/**
 * Lorcana and One Piece carry no TCGplayer id on our side, so their products match by name (10-18, from the 10-17
 * hand-copied titles). Lorcana: category "Lorcana Rise of the Floodborn", product "Madam Mim - Purple Dragon
 * (Enchanted) #208" -> "riseofthefloodborn|208|madammimpurpledragon". Our side: set_name | collector_number | name + subtitle.
 */
export function lorcanaKey(setName: string, number: string, fullName: string): string {
  return `${fold(setName.replace(/^(disney\s+)?lorcana\s*/i, ""))}|${String(number).replace(/^0+/, "")}|${fold(fullName)}`;
}

export function pcLorcanaKey(p: PcProduct): string | null {
  const n = parseProductName(p.name);
  if (!n.number) return null;
  return lorcanaKey(p.console, n.number, n.base.replace(/\([^)]*\)/g, " "));
}

/** One Piece: "Shirahoshi [Jolly Roger] OP03-116 (Pillars of Strength)" -> code "OP03-116" + its printing tag. */
export function pcOnePieceCode(p: PcProduct): { code: string; tags: string[] } | null {
  const m = p.name.match(/\b([A-Z]{1,4}\d{0,2}-\d{3})\b/);
  return m ? { code: m[1], tags: parseProductName(p.name).tags.map(tagKey) } : null;
}

/** PriceCharting One Piece tags -> our tcg_cards.variant printing tags ('' = the base printing). */
const ONEPIECE_TAG: Record<string, string> = {
  alternateart: "alt-art", altart: "alt-art", parallel: "parallel", manga: "manga", jollyroger: "jolly-roger-foil",
  piratefoil: "pirate-foil", fullart: "full-art", texturedfoil: "textured-foil", sp: "special", specialcard: "special", reprint: "reprint",
};

export interface PcMatchCtx {
  /** Our card ids for a TCGplayer product id (Pokémon: tcgplayer_products; Magic: Scryfall's tcgplayer_id). */
  cardsOfTcg: (tcgId: string) => string[];
  /** The variants a card has a TCGplayer series for. */
  variantsOf: (cardId: string) => ReadonlySet<string>;
  /** The card exists in our catalog (1st Edition twins, Yu-Gi-Oh ids). */
  hasCard: (cardId: string) => boolean;
  /** Lorcana: lorcanaKey -> card ids. One Piece: "OP03-116|jolly-roger-foil" ("|" + '' for the base printing) -> card ids. */
  cardsOfKey?: (key: string) => string[];
}

export interface PcWrite {
  game: PcGame;
  cardId: string;
  variant: string;
  usd: number;
  pcId: string;
  tcgId: string;
  salesVolume: number;
  graded9: number | null;
  psa10: number | null;
}

export type PcSkip = "no price" | "no tcg-id" | "unknown product" | "other printing" | "no such variant" | "ambiguous" | "duplicate";

const POKEMON_PATTERN = /^(poke|master|dusk|love|friend|quick|great|ultra|heal|premier|nest|timer|luxury|level|lure|moon|fast|heavy|net|dive|repeat|safari|sport|park|beast|dream)ball(pattern)?$|^energysymbol(pattern)?$|^teamrocket(pattern)?$/;

/** "Poke Ball" -> "pokeBallPattern", "Energy Symbol" -> "energySymbolPattern". */
function pokemonPatternVariant(key: string): string | null {
  if (!POKEMON_PATTERN.test(key)) return null;
  const core = key.replace(/pattern$/, "");
  const m = core.match(/^(.*?)(ball|symbol|rocket)$/);
  if (!m) return null;
  return `${m[1]}${m[2][0].toUpperCase()}${m[2].slice(1)}Pattern`;
}

/** Pokémon tags that name the same TCGplayer product's subtypes; any other tag is a different printing. */
const POKEMON_SAME_PRODUCT = new Set(["1stedition", "reverseholo", "holo", "unlimited"]);

function pickPokemon(p: PcProduct, tags: string[], cardId: string, ctx: PcMatchCtx): { cardId: string; variant: string } | PcSkip {
  const pattern = tags.map(pokemonPatternVariant).find(Boolean) ?? null;
  const other = tags.filter((t) => !POKEMON_SAME_PRODUCT.has(t) && !pokemonPatternVariant(t));
  if (other.length > 0) return "other printing";
  if (pattern) return ctx.variantsOf(cardId).has(pattern) ? { cardId, variant: pattern } : "no such variant";
  if (tags.includes("1stedition")) {
    const target = ctx.hasCard(`${cardId}-1st`) ? `${cardId}-1st` : cardId;
    const firsts = [...ctx.variantsOf(target)].filter((v) => v.startsWith("1stEdition"));
    return firsts.length === 1 ? { cardId: target, variant: firsts[0] } : firsts.length === 0 ? "no such variant" : "ambiguous";
  }
  if (tags.includes("reverseholo")) return ctx.variantsOf(cardId).has("reverseHolofoil") ? { cardId, variant: "reverseHolofoil" } : "no such variant";
  // Plain row: the card's one plain printing (holofoil / normal / unlimited...), never a reverse, pattern or 1st Edition.
  const plain = [...ctx.variantsOf(cardId)].filter((v) => !v.startsWith("1stEdition") && v !== "reverseHolofoil" && !v.endsWith("Pattern"));
  if (plain.length === 1) return { cardId, variant: plain[0] };
  if (plain.length === 0) return "no such variant";
  // "[Holo]" picks the holo one out of normal + holofoil.
  if (tags.includes("holo")) {
    const holo = plain.filter((v) => /holofoil$/i.test(v));
    if (holo.length === 1) return { cardId, variant: holo[0] };
  }
  return "ambiguous";
}

function pickMtg(tags: string[], cardId: string, ctx: PcMatchCtx): { cardId: string; variant: string } | PcSkip {
  // The tcg-id already names the exact Magic printing (borderless, showcase... are their own products); only the finish is a tag.
  const variant = tags.some((t) => t.includes("etched")) ? "etched" : tags.includes("foil") ? "foil" : "nonfoil";
  return ctx.variantsOf(cardId).has(variant) ? { cardId, variant } : "no such variant";
}

function pickByName(game: "lorcana" | "onepiece", p: PcProduct, tags: string[], ctx: PcMatchCtx): { cardId: string; variant: string } | PcSkip {
  const find = ctx.cardsOfKey ?? (() => []);
  if (game === "lorcana") {
    const key = pcLorcanaKey(p);
    if (!key) return "unknown product";
    const cards = find(key);
    if (cards.length === 0) return "unknown product";
    if (cards.length > 1) return "ambiguous";
    if (tags.some((t) => t !== "foil" && !/^(enchanted|iconic|iconicholo|epic|holo)$/.test(t))) return "other printing";
    // Enchanted / Iconic / Epic cards only come foil: their plain row is the foil price.
    const foilOnly = /\((enchanted|iconic|epic)\)/i.test(p.name) || tags.some((t) => t.startsWith("iconic") || t === "enchanted" || t === "epic");
    const variant = tags.includes("foil") || foilOnly ? "foil" : "normal";
    return ctx.variantsOf(cards[0]).has(variant) ? { cardId: cards[0], variant } : "no such variant";
  }
  const op = pcOnePieceCode(p);
  if (!op) return "unknown product";
  const known = op.tags.map((t) => ONEPIECE_TAG[t]).filter(Boolean);
  if (known.length < op.tags.length) return "other printing";
  if (new Set(known).size > 1) return "ambiguous";
  const cards = find(`${op.code}|${known[0] ?? ""}`);
  if (cards.length === 0) return "unknown product";
  if (cards.length > 1) return "ambiguous";
  return ctx.variantsOf(cards[0]).has("normal") ? { cardId: cards[0], variant: "normal" } : "no such variant";
}

/** Every product's write (or why it was skipped). One write per printing: the first product claiming it wins, later ones count as duplicates. */
export function planPcImport(game: PcGame, products: PcProduct[], ctx: PcMatchCtx): { writes: PcWrite[]; skipped: Record<PcSkip, number> } {
  const skipped: Record<PcSkip, number> = { "no price": 0, "no tcg-id": 0, "unknown product": 0, "other printing": 0, "no such variant": 0, ambiguous: 0, duplicate: 0 };
  const writes: PcWrite[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    if (p.loose == null) {
      skipped["no price"]++;
      continue;
    }
    const tags = parseProductName(p.name).tags.map(tagKey);
    let pick: { cardId: string; variant: string } | PcSkip;
    if (game === "lorcana" || game === "onepiece") {
      pick = pickByName(game, p, tags, ctx);
    } else if (!p.tcgId) {
      skipped["no tcg-id"]++;
      continue;
    } else if (game === "yugioh") {
      const id = tags.includes("1stedition") ? `ygo-${p.tcgId}-1st` : `ygo-${p.tcgId}`;
      pick = ctx.hasCard(id) ? { cardId: id, variant: "normal" } : "unknown product";
    } else {
      const cards = ctx.cardsOfTcg(p.tcgId);
      if (cards.length === 0) pick = "unknown product";
      else if (cards.length > 1) pick = "ambiguous";
      else pick = game === "pokemon" ? pickPokemon(p, tags, cards[0], ctx) : pickMtg(tags, cards[0], ctx);
    }
    if (typeof pick === "string") {
      skipped[pick]++;
      continue;
    }
    const k = `${pick.cardId}|${pick.variant}`;
    if (seen.has(k)) {
      skipped.duplicate++;
      continue;
    }
    seen.add(k);
    writes.push({ game, cardId: pick.cardId, variant: pick.variant, usd: p.loose, pcId: p.id, tcgId: p.tcgId ?? "", salesVolume: p.salesVolume, graded9: p.graded9, psa10: p.psa10 });
  }
  return { writes, skipped };
}
