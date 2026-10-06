/**
 * CardTrader (cardtrader.com) as a Yu-Gi-Oh! price source for cards TCGplayer
 * can't price (10-06, Chris made the account: "use every resource available
 * to get the cards priced"). Its expansions carry the real set code ("dcr",
 * "lod", "wi26"), so the classic "Worldwide English" prints Cardmarket can't
 * tell apart match exactly: set code + collector number (+ rarity when the
 * number repeats) + name. Prices are LISTINGS, not sales: the cheapest Near
 * Mint English copy, and a lone listing at $50+ is skipped (10-06 dry run: one
 * Des Volstgalph at $6,341). Needs CARDTRADER_TOKEN (Full API JWT). No
 * "server-only": tests import the pure parts.
 */

export const CARDTRADER_SOURCE = "cardtrader";
const API = "https://api.cardtrader.com/api/v2";
const YUGIOH_GAME_ID = 4;

export interface CtBlueprint {
  id: number;
  name: string;
  expansion_id?: number;
  fixed_properties?: { collector_number?: string; yugioh_rarity?: string };
}

export interface CtListing {
  blueprint_id?: number;
  price_cents?: number;
  price_currency?: string;
  properties_hash?: { condition?: string; yugioh_language?: string; first_edition?: boolean };
}

export interface CtGapRow {
  id: string;
  name: string;
  number: string;
  rarity: string | null;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** "DCR-EN016" / "016" / "EN016" → "16". */
const numberOf = (s: unknown) => String(s ?? "").split("-").pop()!.replace(/^[a-z]+/i, "").replace(/^0+(?=\d)/, "").toLowerCase();
/** Our set prefix ("DCR-EN016" → "dcr"); SJC promos live in CardTrader's "sjcs". */
export const expansionCodeOf = (number: string) => {
  const code = number.split("-")[0].toLowerCase();
  return code === "sjc" ? "sjcs" : code;
};

/** Pure: our row → its one blueprint in the expansion, or null. */
export function matchBlueprint(row: CtGapRow, blueprints: CtBlueprint[]): CtBlueprint | null {
  let cand = blueprints.filter((b) => numberOf(b.fixed_properties?.collector_number) === numberOf(row.number));
  if (cand.length > 1 && row.rarity) cand = cand.filter((b) => norm(b.fixed_properties?.yugioh_rarity) === norm(row.rarity));
  if (cand.length !== 1 || norm(cand[0].name) !== norm(row.name)) return null;
  return cand[0];
}

/** Pure: a blueprint's listings → today's dollar price (cheapest NM English), or null. */
export function listingUsd(listings: CtListing[], firstEdition: boolean, usdPerEur: number | null): number | null {
  const prices = listings
    .filter((p) => {
      const pr = p.properties_hash ?? {};
      if (pr.yugioh_language && pr.yugioh_language !== "en") return false;
      if (pr.condition && !/^(near mint|mint)$/i.test(pr.condition)) return false;
      if (pr.first_edition !== undefined && !!pr.first_edition !== firstEdition) return false;
      return true;
    })
    .map((p) => {
      const cents = p.price_cents ?? 0;
      if (!(cents > 0)) return null;
      if ((p.price_currency ?? "USD") === "USD") return cents / 100;
      if (p.price_currency === "EUR" && usdPerEur) return (cents / 100) * usdPerEur;
      return null;
    })
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  if (!prices.length) return null;
  if (prices.length === 1 && prices[0] >= 50) return null;
  return Math.round(prices[0] * 100) / 100;
}

async function ct<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "CardFlip/1.0 (support@cardflip.io)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`cardtrader ${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

const LORCANA_GAME_ID = 18;
/** Our Lorcana set codes → CardTrader expansion codes (10-06 dry run). The caller only passes released sets, so 14+ fill from launch day. */
const LORCANA_EXPANSIONS: Record<string, string> = { P1: "promos", cp: "lcp", C2: "lcp", P2: "p2", P3: "p3", P4: "p4", D23: "d23", "11": "lor11", "14": "lor14", "15": "lor15", CC1: "cc", PD1: "pd1" };

export interface CtLorcanaRow {
  id: string;
  name: string;
  subtitle: string | null;
  setCode: string;
  number: string;
}

/** Pure: Lorcana row → its one blueprint ("Kronk - Laid Back", number "020"), or null. */
export function matchLorcanaBlueprint(row: CtLorcanaRow, blueprints: CtBlueprint[]): CtBlueprint | null {
  const want = norm(row.subtitle ? `${row.name} - ${row.subtitle}` : row.name);
  const cand = blueprints.filter((b) => numberOf(b.fixed_properties?.collector_number) === numberOf(row.number) && norm(b.name) === want);
  return cand.length === 1 ? cand[0] : null;
}

/** Pure: Lorcana listings → cheapest NM English plain and foil, same lone-$50 guard. */
export function lorcanaListingUsd(listings: CtListing[], usdPerEur: number | null): { usd: number | null; foil: number | null } {
  const pick = (foil: boolean) =>
    listingUsd(
      listings.filter((l) => {
        const p = (l.properties_hash ?? {}) as Record<string, unknown>;
        return (p.lorcana_language ?? "en") === "en" && !!p.lorcana_foil === foil;
      }),
      false,
      usdPerEur,
    );
  return { usd: pick(false), foil: pick(true) };
}

/** Live: Lorcana gap rows → plain/foil prices for the ones CardTrader lists. */
export async function cardtraderLorcanaPrices(rows: CtLorcanaRow[], token: string, usdPerEur: number | null): Promise<{ id: string; usd: number | null; foil: number | null }[]> {
  const expansions = (await ct<{ id: number; game_id: number; code: string }[]>("/expansions", token)).filter((e) => e.game_id === LORCANA_GAME_ID);
  const byCode = new Map(expansions.map((e) => [e.code.toLowerCase(), e.id]));
  const groups = new Map<number, CtLorcanaRow[]>();
  for (const r of rows) {
    const code = LORCANA_EXPANSIONS[r.setCode];
    const id = code ? byCode.get(code) : undefined;
    if (id != null) groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  const out: { id: string; usd: number | null; foil: number | null }[] = [];
  for (const [expansionId, list] of groups) {
    try {
      const blueprints = await ct<CtBlueprint[]>(`/blueprints/export?expansion_id=${expansionId}`, token);
      const market = await ct<Record<string, CtListing[]>>(`/marketplace/products?expansion_id=${expansionId}`, token);
      for (const r of list) {
        const b = matchLorcanaBlueprint(r, blueprints);
        if (!b) continue;
        const p = lorcanaListingUsd(market[String(b.id)] ?? [], usdPerEur);
        if (p.usd != null || p.foil != null) out.push({ id: r.id, ...p });
      }
    } catch (err) {
      console.warn(`cardtrader lorcana expansion ${expansionId}:`, err instanceof Error ? err.message : err);
    }
    await new Promise((res) => setTimeout(res, 120));
  }
  return out;
}

/** Live: gap rows → { id, usd } for the ones CardTrader prices. Two calls per expansion, ~120 ms apart. */
export async function cardtraderYugiohPrices(rows: CtGapRow[], token: string, usdPerEur: number | null): Promise<{ id: string; usd: number }[]> {
  const expansions = (await ct<{ id: number; game_id: number; code: string }[]>("/expansions", token)).filter((e) => e.game_id === YUGIOH_GAME_ID);
  const byCode = new Map(expansions.map((e) => [e.code.toLowerCase(), e.id]));
  const groups = new Map<number, CtGapRow[]>();
  for (const r of rows) {
    const id = byCode.get(expansionCodeOf(r.number));
    if (id != null) groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  const out: { id: string; usd: number }[] = [];
  for (const [expansionId, list] of groups) {
    try {
      const blueprints = await ct<CtBlueprint[]>(`/blueprints/export?expansion_id=${expansionId}`, token);
      const market = await ct<Record<string, CtListing[]>>(`/marketplace/products?expansion_id=${expansionId}`, token);
      for (const r of list) {
        const b = matchBlueprint(r, blueprints);
        if (!b) continue;
        const usd = listingUsd(market[String(b.id)] ?? [], r.id.endsWith("-1st"), usdPerEur);
        if (usd != null) out.push({ id: r.id, usd });
      }
    } catch (err) {
      console.warn(`cardtrader expansion ${expansionId}:`, err instanceof Error ? err.message : err);
    }
    await new Promise((res) => setTimeout(res, 120));
  }
  return out;
}
