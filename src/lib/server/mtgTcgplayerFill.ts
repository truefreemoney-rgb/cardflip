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
const UA = { "User-Agent": "CardFlip/1.0 (support@cardflip.io)", Accept: "application/json" };

export interface MtgGapRow {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  number: string;
  finishes: string;
  oracleId?: string | null;
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
}

export interface MtgFill {
  id: string;
  usd: number | null;
  foil: number | null;
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STAMP = /gold[- ]stamped/i;
/** Product name → bare card name: drop "Art Card" and every parenthetical. */
const bareProduct = (n: string) => fold(n.replace(/\([^)]*\)/g, " ").replace(/\bart card\b/i, " "));
const bareNumber = (n: string) => n.split("/")[0].trim().toLowerCase().replace(/^0+(?=\w)/, "");

/**
 * Pure: Scryfall set → TCGplayer group. Abbreviation first (LEA, LEB, SUM,
 * SLZ…), then the name; Scryfall's "Strixhaven Art Series" is TCGplayer's
 * "Art Series: Strixhaven" and "Crimson Vow Art Series" is "Art Series:
 * Innistrad: Crimson Vow", so an Art Series set also matches the group's last
 * ":" segment. Several candidates = no match.
 */
export function matchGroup(setCode: string, setName: string, groups: TcgGroup[]): TcgGroup | null {
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
  for (const r of rows) {
    const name = fold(r.name);
    let num = bareNumber(r.number);
    const stamped = /^\d+s$/.test(num);
    if (stamped) num = num.slice(0, -1);
    let hits = byKey.get(key(name, num, stamped)) ?? [];
    if (!hits.length && !numbered && !stamped && rowsByName.get(name) === 1) hits = byName.get(name) ?? [];
    if (hits.length !== 1) continue;
    const pr = hits[0].prices;
    const foilOnly = !/nonfoil/.test(r.finishes) && /foil/.test(r.finishes);
    const usd = foilOnly ? null : pr["Normal"] ?? null;
    const foil = pr["Foil"] ?? (foilOnly ? pr["Normal"] ?? null : null);
    if (usd != null || foil != null) out.push({ id: r.id, usd, foil });
  }
  return out;
}

const listOf = <T>(j: unknown): T[] => ((j as { results?: T[] })?.results ?? []) as T[];
const getJson = async (url: string) => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};
const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** One TCGplayer group's products with a price (market, else mid — the Yu-Gi-Oh sync rule). */
export async function groupProducts(groupId: number): Promise<TcgProduct[]> {
  const products = listOf<{ productId: number; name?: string; extendedData?: { name: string; value: string }[] }>(await getJson(`${API}/${groupId}/products`));
  const prices = listOf<{ productId: number; subTypeName?: string; marketPrice?: unknown; midPrice?: unknown }>(await getJson(`${API}/${groupId}/prices`));
  const byProduct = new Map<number, Record<string, number>>();
  for (const p of prices) {
    const v = pos(p.marketPrice) ?? pos(p.midPrice);
    if (v == null) continue;
    byProduct.set(p.productId, { ...(byProduct.get(p.productId) ?? {}), [p.subTypeName ?? "Normal"]: v });
  }
  const out: TcgProduct[] = [];
  for (const p of products) {
    const priced = byProduct.get(p.productId);
    if (!priced || !p.name) continue;
    out.push({ name: p.name, number: p.extendedData?.find((e) => e.name === "Number")?.value ?? "", prices: priced });
  }
  return out;
}

/** Gap rows (ids given) with their set details, read from the mirror. */
export async function readMtgGapRows(ids: string[]): Promise<MtgGapRow[]> {
  const out: MtgGapRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = (await db
      .prepare(`SELECT id, oracle_id, name, set_code, set_name, collector_number, finishes FROM mtg_cards WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk)) as { id: string; oracle_id: string | null; name: string; set_code: string; set_name: string; collector_number: string; finishes: string | null }[];
    for (const r of rows)
      out.push({ id: r.id, name: r.name, setCode: r.set_code, setName: r.set_name, number: r.collector_number, finishes: r.finishes ?? "", oracleId: r.oracle_id });
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
  const work: { group: TcgGroup; rows: MtgGapRow[] }[] = [];
  const unmatchedSets: string[] = [];
  for (const [code, list] of bySet) {
    const g = matchGroup(code, list[0].setName, groups);
    if (g) work.push({ group: g, rows: list });
    else unmatchedSets.push(`${code} ${list[0].setName} (${list.length})`);
  }
  const fills: MtgFill[] = [];
  const queue = [...work];
  const worker = async () => {
    for (let w = queue.shift(); w; w = queue.shift()) {
      try {
        fills.push(...matchMtgProducts(w.rows, await groupProducts(w.group.groupId)));
      } catch (err) {
        console.warn(`mtg tcgplayer group ${w.group.groupId}:`, err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  const oracleIds = [...new Set(rows.map((r) => r.oracleId).filter((o): o is string => !!o))];
  const guarded = guardFills(fills, rows, oracleIds.length ? await readOracleMaxUsd(oracleIds) : new Map());
  return { fills: guarded, groups: work.length, unmatchedSets, dropped: fills.length - guarded.length };
}
