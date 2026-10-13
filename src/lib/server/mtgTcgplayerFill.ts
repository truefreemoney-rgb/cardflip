import { TCGCSV_HEADERS, tcgcsvFetch } from "@/lib/server/tcgcsv";
import { db } from "@/lib/db";

/**
 * Magic printings Scryfall's bulk file leaves without a dollar price (10-05:
 * ~4,050 released English rows — 2,601 Art Series cards, Alpha/Beta, Summer
 * Magic, the Zeta Set, 8th/9th Edition foil ★ cards, The List, Secret Lair
 * one-offs) take TCGplayer's price from tcgcsv.com category 1. A row only
 * takes a price when exactly one TCGplayer product in the matched group has
 * the same name AND collector number (Art Series "12s" = the Gold-Stamped
 * Signature product of number 12); a group with no numbers falls back to a
 * name that is unique on both sides. No "server-only": scripts drive it too.
 */

const API = "https://tcgcsv.com/tcgplayer/1";
const UA = TCGCSV_HEADERS;

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
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STAMP = /gold[- ]stamped/i;
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
const GROUP_IDS: Record<string, number[]> = {
  who: [23165, 23166], // Universes Beyond: Doctor Who + its Planechase, both "WHO"
};

/** The List's Scryfall numbers carry the original set ("KLD-2"); TCGplayer prints only the number. */
const listNumber = (setCode: string, number: string) => (setCode.toLowerCase() === "plst" ? number.replace(/^[a-z0-9]+-/i, "") : number);

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
  const art = /\bart series$/i.test(setName.trim());
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
    let num = bareNumber(listNumber(r.setCode, r.number));
    const stamped = /^\d+s$/.test(num);
    if (stamped) num = num.slice(0, -1);
    const art = /art series$/i.test(r.setName.trim());
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
    if (hits.length !== 1) continue;
    const pr = hits[0].prices;
    const foilOnly = !/nonfoil/.test(r.finishes) && /foil/.test(r.finishes);
    const usd = foilOnly ? null : pr["Normal"] ?? null;
    const foil = pr["Foil"] ?? (foilOnly ? pr["Normal"] ?? null : null);
    const lows = hits[0].lows ?? {};
    const usdLow = usd == null ? null : (lows["Normal"] ?? null);
    const foilLow = foil == null ? null : (lows["Foil"] ?? (foilOnly ? (lows["Normal"] ?? null) : null));
    if (usd != null || foil != null) out.push({ id: r.id, usd, foil, ...(usdLow != null ? { usdLow } : {}), ...(foilLow != null ? { foilLow } : {}), ...(isSerial(hits[0].name) ? { serial: true } : {}) });
  }
  return out;
}

const listOf = <T>(j: unknown): T[] => ((j as { results?: T[] })?.results ?? []) as T[];
const getJson = async (url: string) => {
  const r = await tcgcsvFetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};
const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
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

/** One TCGplayer group's products with a price (market, else mid — the Yu-Gi-Oh sync rule). */
export async function groupProducts(groupId: number): Promise<TcgProduct[]> {
  const products = listOf<{ productId: number; name?: string; extendedData?: { name: string; value: string }[] }>(await getJson(`${API}/${groupId}/products`));
  const prices = listOf<{ productId: number; subTypeName?: string; marketPrice?: unknown; midPrice?: unknown; lowPrice?: unknown }>(await getJson(`${API}/${groupId}/prices`));
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
    out.push({ name: p.name, number: p.extendedData?.find((e) => e.name === "Number")?.value ?? "", prices: priced, lows: lowByProduct.get(p.productId) ?? {} });
  }
  return out;
}

/** Gap rows (ids given) with their set details, read from the mirror. */
export async function readMtgGapRows(ids: string[]): Promise<MtgGapRow[]> {
  const out: MtgGapRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = (await db
      .prepare(`SELECT id, oracle_id, name, set_code, set_name, collector_number, finishes, set_release_date FROM mtg_cards WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk)) as { id: string; oracle_id: string | null; name: string; set_code: string; set_name: string; collector_number: string; finishes: string | null; set_release_date: string | null }[];
    for (const r of rows)
      out.push({ id: r.id, name: r.name, setCode: r.set_code, setName: r.set_name, number: r.collector_number, finishes: r.finishes ?? "", oracleId: r.oracle_id, released: r.set_release_date ?? "" });
  }
  return out;
}

/** Dearest dollar price among a card's other (non-Art-Series) printings, per oracle id. */
export async function readOracleMaxUsd(oracleIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < oracleIds.length; i += 500) {
    const chunk = oracleIds.slice(i, i + 500);
    const rows = (await db
      .prepare(`SELECT oracle_id, MAX(MAX(COALESCE(price_usd, 0)), MAX(COALESCE(price_usd_foil, 0)), MAX(COALESCE(price_usd_etched, 0))) AS m
        FROM mtg_cards WHERE oracle_id IN (${chunk.map(() => "?").join(",")}) AND set_name NOT LIKE '%Art Series' GROUP BY oracle_id`)
      .all(...chunk)) as { oracle_id: string; m: number }[];
    for (const r of rows) if (Number(r.m) > 0) out.set(r.oracle_id, Number(r.m));
  }
  return out;
}

/**
 * Pure: drop a fill priced over 15× every other printing of the same card
 * (and over $20). 10-05 dry run: TCGplayer had Alpha Veteran Bodyguard at
 * $6,495 vs $112 elsewhere, a one-off (likely graded) sale. Blank beats wrong.
 */
export function guardFills(fills: MtgFill[], rows: MtgGapRow[], oracleMax: Map<string, number>): MtgFill[] {
  const oracle = new Map(rows.map((r) => [r.id, r.oracleId ?? ""]));
  return fills.filter((f) => {
    if (f.serial) return true; // 10-13: serial Bitterbloom Bearer $3,997 vs $31 normal; eBay sold $3,300-$4,239
    const p = Math.max(f.usd ?? 0, f.foil ?? 0);
    const ref = oracleMax.get(oracle.get(f.id) ?? "") ?? 0;
    return !(ref > 0 && p > 20 && p > 15 * ref);
  });
}

/** Live: gap rows → TCGplayer fills, fetching only the groups the gaps need. */
export async function tcgplayerFills(rows: MtgGapRow[]): Promise<{ fills: MtgFill[]; groups: number; unmatchedSets: string[]; dropped: number }> {
  const groups = listOf<TcgGroup>(await getJson(`${API}/groups`));
  const bySet = new Map<string, MtgGapRow[]>();
  for (const r of rows) bySet.set(r.setCode, [...(bySet.get(r.setCode) ?? []), r]);
  const work: { groupIds: number[]; rows: MtgGapRow[] }[] = [];
  const unmatchedSets: string[] = [];
  for (const [code, list] of bySet) {
    const ids = GROUP_IDS[code.toLowerCase()];
    const g = ids ? null : matchGroup(code, list[0].setName, groups);
    if (ids) work.push({ groupIds: ids, rows: list });
    else if (g) work.push({ groupIds: [g.groupId], rows: list });
    else unmatchedSets.push(`${code} ${list[0].setName} (${list.length})`);
  }
  const fills: MtgFill[] = [];
  const queue = [...work];
  const worker = async () => {
    for (let w = queue.shift(); w; w = queue.shift()) {
      try {
        const products: TcgProduct[] = [];
        for (const id of w.groupIds) products.push(...(await groupProducts(id)));
        fills.push(...matchMtgProducts(w.rows, products));
      } catch (err) {
        console.warn(`mtg tcgplayer group ${w.groupIds.join("+")}:`, err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  const oracleIds = [...new Set(rows.map((r) => r.oracleId).filter((o): o is string => !!o))];
  const guarded = guardFills(fills, rows, oracleIds.length ? await readOracleMaxUsd(oracleIds) : new Map());
  return { fills: guarded, groups: work.length, unmatchedSets, dropped: fills.length - guarded.length };
}
