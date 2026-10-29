/**
 * Magic printing ↔ TCGplayer product matching, pure (no server imports), so
 * scripts/sync-mtg-art.mjs can run it with --experimental-strip-types alone.
 * lib/server/mtgTcgplayerFill.ts re-exports everything here and adds the
 * tcgcsv fetches, the mirror reads and the 15× guard.
 *
 * A row only takes a price when exactly one TCGplayer product in the matched
 * group has the same name AND collector number (Art Series "12s" = the
 * Gold-Stamped Signature product of number 12); a group with no numbers falls
 * back to a name that is unique on both sides.
 */

export interface MtgGapRow {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  number: string;
  finishes: string;
  oracleId?: string | null;
  /** Set release day (YYYY-MM-DD). */
  released?: string;
}

export interface TcgGroup {
  groupId: number;
  name: string;
  abbreviation?: string | null;
}

export interface TcgProduct {
  name: string;
  number: string;
  /** TCGplayer subtype → price ("Normal", "Foil"). */
  prices: Record<string, number>;
  /** TCGplayer subtype → cheapest live listing (the price guard's check on a market frozen on an old sale). */
  lows?: Record<string, number>;
  /** TCGplayer product id (10-29: the gold-stamped Art Series twin takes its picture from the product's scan). */
  productId?: number;
}

/** A serial-numbered product (a few hundred copies exist): far above its other printings is normal, so the 15x guard skips it. */
export const isSerial = (productName: string) => /serial(?:ized| numbered)/i.test(productName);

export interface MtgFill {
  id: string;
  usd: number | null;
  foil: number | null;
  /** Cheapest live listings beside those prices, when TCGplayer has one. */
  usdLow?: number | null;
  foilLow?: number | null;
  /** Matched a serial-numbered product (guardFills lets it through). */
  serial?: boolean;
  /** The matched product's TCGplayer id, when the product carried one. */
  productId?: number;
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** The signed / symbol-stamped Art Series product: "(Gold-Stamped Signature)", and Foundations' plain "(Stamped Signature)" (10-17). */
const STAMP = /gold[- ]stamped|stamped signature/i;
/** Whether a TCGplayer product name is the gold-stamped signature copy of an art card. */
export const isStampedProduct = (productName: string) => STAMP.test(productName);
/**
 * Product name → bare card name: drop "Art Card" and every parenthetical, plus
 * the words TCGplayer puts before "Art Card" that Scryfall's name lacks
 * (10-13: "Dinosaur Token Art Card", "Valley Questcaller 2 Art Card",
 * "Omniscience Anime Art Card"; the number still tells those apart).
 */
const bareProduct = (n: string) =>
  fold(n.replace(/\([^)]*\)/g, " ").replace(/(?:\s+(?:token|anime|\d+))*\s+art card\b/i, " ").replace(/\bart card\b/i, " "));
/** Scryfall row name → names to try: whole (a doubled "A // B // A // B" halved), then the front face. */
const rowNames = (n: string) => {
  const parts = n.split(" // ");
  const half = parts.length % 2 === 0 && parts.slice(0, parts.length / 2).join("|") === parts.slice(parts.length / 2).join("|");
  const whole = fold(half ? parts.slice(0, parts.length / 2).join(" // ") : n);
  const front = fold(parts[0]);
  return front === whole ? [whole] : [whole, front];
};
const bareNumber = (n: string) => n.split("/")[0].trim().toLowerCase().replace(/^0+(?=\w)/, "");

/** Scryfall set code → TCGplayer group abbreviation, where neither rule finds it. */
const GROUP_ALIASES: Record<string, string> = {
  asnc: "ASSNC", // "New Capenna Art Series" vs "Art Series: Streets of New Capenna"
  plst: "LIST", // "The List" vs "The List Reprints" (numbers: see listNumber)
  cst: "CTD", // Coldsnap Theme Decks
  // Duel Decks Anthology is its own printing (TCGplayer "Duel Decks: Anthology"), never the original decks' price.
  dvd: "DD3",
  gvl: "DD3",
  jvc: "DD3",
  mgb: "GBP", // Multiverse Gift Box → Gift Boxes and Promos
  p09: "MPRP", // Magic Player Rewards 2009 → Magic Player Rewards
  pcmp: "CHAMPS",
  pmei: "MEDIA",
  afic: "FIC", // Final Fantasy Scene Box cards sit with the Commander decks
  atle: "ASTLA", // Avatar Eternal Art Series cards sit unnumbered in "Art Series: Avatar: The Last Airbender"
};
/** Scryfall set code → several TCGplayer groups searched as one (their abbreviation is shared). */
export const GROUP_IDS: Record<string, number[]> = {
  who: [23165, 23166], // Universes Beyond: Doctor Who + its Planechase, both "WHO"
};

/**
 * Art Series sets whose Scryfall numbers run ahead of TCGplayer's from some card on: Scryfall numbers five Clue art cards
 * 41-45 in Karlov Manor that TCGplayer does not list, so its 46 (Aurelia) is TCGplayer's 41 (10-17).
 */
const NUMBER_SHIFT: Record<string, { from: number; by: number }> = {
  amkm: { from: 46, by: -5 },
};

/** The List's Scryfall numbers carry the original set ("KLD-2"); TCGplayer prints only the number. Plus NUMBER_SHIFT. */
const listNumber = (setCode: string, number: string) => {
  const code = setCode.toLowerCase();
  if (code === "plst") return number.replace(/^[a-z0-9]+-/i, "");
  const shift = NUMBER_SHIFT[code];
  const n = /^\d+$/.test(number) ? Number(number) : NaN;
  return shift && n >= shift.from ? String(n + shift.by) : number;
};

/** Words of 4+ letters, for the Art Series number fallback. */
const words = (s: string) => new Set(s.split(" ").filter((w) => w.length >= 4));

/** An Art Series set, by Scryfall's set name ("Strixhaven Art Series"). */
export const isArtSeriesSet = (setName: string) => /\bart series$/i.test(setName.trim());

/**
 * Pure: Scryfall set → TCGplayer group. Abbreviation first (LEA, LEB, SUM,
 * SLZ…), then the name; Scryfall's "Strixhaven Art Series" is TCGplayer's
 * "Art Series: Strixhaven" and "Crimson Vow Art Series" is "Art Series:
 * Innistrad: Crimson Vow", so an Art Series set also matches the group's last
 * ":" segment. Several candidates = no match.
 */
export function matchGroup(setCode: string, setName: string, groups: TcgGroup[]): TcgGroup | null {
  const alias = GROUP_ALIASES[setCode.toLowerCase()];
  if (alias) {
    const a = groups.filter((g) => (g.abbreviation ?? "").toUpperCase() === alias);
    if (a.length === 1) return a[0];
  }
  const byAbbr = groups.filter((g) => (g.abbreviation ?? "").toLowerCase() === setCode.toLowerCase());
  if (byAbbr.length === 1) return byAbbr[0];
  const art = isArtSeriesSet(setName);
  const base = fold(setName.replace(/\bart series$/i, ""));
  const hits = groups.filter((g) => {
    const gArt = /^art series:/i.test(g.name);
    if (gArt !== art) return false;
    const rest = g.name.replace(/^art series:\s*/i, "");
    return fold(rest) === base || fold(rest.split(":").pop() ?? "") === base;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Pure: one group's gap rows → fills. Exported for scripts/test-mtg-tcgplayer-fill.mjs. */
export function matchMtgProducts(rows: MtgGapRow[], products: TcgProduct[]): MtgFill[] {
  const key = (name: string, num: string, stamped: boolean) => `${name}#${num}#${stamped ? "s" : ""}`;
  const byKey = new Map<string, TcgProduct[]>();
  const byName = new Map<string, TcgProduct[]>();
  for (const p of products) {
    const stamped = STAMP.test(p.name);
    const k = key(bareProduct(p.name), bareNumber(p.number), stamped);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
    if (!stamped) byName.set(bareProduct(p.name), [...(byName.get(bareProduct(p.name)) ?? []), p]);
  }
  const numbered = products.some((p) => p.number);
  const rowsByName = new Map<string, number>();
  for (const r of rows) rowsByName.set(fold(r.name), (rowsByName.get(fold(r.name)) ?? 0) + 1);
  const out: MtgFill[] = [];
  const rowKeys = new Set(rows.map((r) => `${fold(r.name)}#${bareNumber(listNumber(r.setCode, r.number))}`));
  for (const r of rows) {
    // A stamped number ("12s") sheds its "s" before the set's number shift (Karlov Manor 46s is TCGplayer's 41, 10-29).
    const raw = bareNumber(r.number);
    const stamped = /^\d+s$/.test(raw);
    const num = bareNumber(listNumber(r.setCode, stamped ? raw.slice(0, -1) : r.number));
    const art = isArtSeriesSet(r.setName);
    // Art Series "1c" (Scryfall) = TCGplayer #1 (Marvel Thanos 1/9…9/9), unless a row of that name owns plain "1" (Nine-Lives Familiar 36 + 36b).
    const plain = num.replace(/(?<=\d)[a-z]$/, "");
    const nums = art && !stamped && plain !== num && !rowKeys.has(`${fold(r.name)}#${plain}`) ? [num, plain] : [num];
    let hits: TcgProduct[] = [];
    for (const name of art ? rowNames(r.name) : [fold(r.name)]) {
      for (const n of nums) {
        hits = byKey.get(key(name, n, stamped)) ?? [];
        if (hits.length) break;
      }
      // No name + number hit (unnumbered group, or numbers that differ like
      // Karlov Manor Art Series 46 vs 41 or Marvel "1b" vs 1): a name that is
      // unique on both sides. Two products of one name (Aurelia 36 + 41) = no match.
      // Numbered groups only for Art Series: elsewhere a number miss can be another printing.
      if (!hits.length && !stamped && (!numbered || art) && rowsByName.get(fold(r.name)) === 1) hits = byName.get(name) ?? [];
      if (hits.length) break;
    }
    // Art Series named for the art, not the card (10-17): Scryfall "Gnoll Hunter" / "Loathsome Troll // Troll" #21 is
    // TCGplayer "Gnoll Art Card" / "Troll Art Card" #21. The one plain product of that number, if it shares a word with a face.
    if (!hits.length && art && numbered) {
      const faces = words(r.name.split(" // ").map(fold).join(" "));
      const same = products.filter((p) => STAMP.test(p.name) === stamped && nums.includes(bareNumber(p.number)));
      if (same.length === 1 && [...words(bareProduct(same[0].name))].some((w) => faces.has(w))) hits = same;
    }
    if (hits.length !== 1) continue;
    const pr = hits[0].prices;
    const foilOnly = !/nonfoil/.test(r.finishes) && /foil/.test(r.finishes);
    const usd = foilOnly ? null : pr["Normal"] ?? null;
    const foil = pr["Foil"] ?? (foilOnly ? pr["Normal"] ?? null : null);
    const lows = hits[0].lows ?? {};
    const usdLow = usd == null ? null : (lows["Normal"] ?? null);
    const foilLow = foil == null ? null : (lows["Foil"] ?? (foilOnly ? (lows["Normal"] ?? null) : null));
    if (usd != null || foil != null)
      out.push({
        id: r.id,
        usd,
        foil,
        ...(usdLow != null ? { usdLow } : {}),
        ...(foilLow != null ? { foilLow } : {}),
        ...(isSerial(hits[0].name) ? { serial: true } : {}),
        ...(hits[0].productId != null ? { productId: hits[0].productId } : {}),
      });
  }
  return out;
}

export const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
/**
 * No sale (market) price, only sellers' asking prices (mid): fine for a cheap
 * card, never above ASKING_MAX_USD (10-13, Chris: unusual prices are checked
 * against eBay). TCGplayer's mid for Alpha Jade Monolith was $1,200 while eBay
 * sold it at $157-$249; a blank goes to the eBay check list instead.
 */
export const ASKING_MAX_USD = 20;
export const askingPrice = (mid: unknown) => {
  const v = pos(mid);
  return v != null && v <= ASKING_MAX_USD ? v : null;
};

/** tcgcsv's /products and /prices rows for one group, as the fill reads them. */
export interface TcgcsvProduct {
  productId: number;
  name?: string;
  extendedData?: { name: string; value: string }[];
}
export interface TcgcsvPrice {
  productId: number;
  subTypeName?: string;
  marketPrice?: unknown;
  midPrice?: unknown;
  lowPrice?: unknown;
}

/** Pure: one group's products with a price (market, else mid — the Yu-Gi-Oh sync rule), with their TCGplayer ids. */
export function pricedProducts(products: TcgcsvProduct[], prices: TcgcsvPrice[]): TcgProduct[] {
  const byProduct = new Map<number, Record<string, number>>();
  const lowByProduct = new Map<number, Record<string, number>>();
  for (const p of prices) {
    const v = pos(p.marketPrice) ?? askingPrice(p.midPrice);
    if (v == null) continue;
    byProduct.set(p.productId, { ...(byProduct.get(p.productId) ?? {}), [p.subTypeName ?? "Normal"]: v });
    const low = pos(p.lowPrice);
    if (low != null) lowByProduct.set(p.productId, { ...(lowByProduct.get(p.productId) ?? {}), [p.subTypeName ?? "Normal"]: low });
  }
  const out: TcgProduct[] = [];
  for (const p of products) {
    const priced = byProduct.get(p.productId);
    if (!priced || !p.name) continue;
    out.push({ name: p.name, number: p.extendedData?.find((e) => e.name === "Number")?.value ?? "", prices: priced, lows: lowByProduct.get(p.productId) ?? {}, productId: p.productId });
  }
  return out;
}

/** The TCGplayer product scan save-pictures.mjs reads (the same URL form as data/mtg-tcgplayer-ids.json rows). */
export const tcgplayerScanUrl = (productId: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;
