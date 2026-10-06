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
