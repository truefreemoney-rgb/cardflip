/**
 * The signed-in seller's own cards (docs/APP-PLAN.md step 3), read through
 * the same routes the website's My Cards uses. Signed-in routes carry the
 * bearer token through lib/api.ts.
 */
import { formatMoney } from "@/lib/money";
import { PRICE_FLAG_NOTE } from "@/lib/priceFlag";
import type { GameId } from "@/lib/types";
import { api } from "./api";

export type CardStatus = "ready" | "listed" | "sold";

/** The fields of the site's CardRecord (lib/server/cards.ts) the app shows. */
export interface OwnedCard {
  id: string;
  kind: "card" | "sealed";
  game: GameId;
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  productType: string | null;
  status: CardStatus;
  price: number;
  quantity: number;
  catalogCardId: string | null;
  soldPrice: number | null;
  soldAt: number | null;
  ebayEndedAt: number | null;
  ebayListingUrl: string | null;
  rarity: string | null;
  category: string | null;
  firstEdition: boolean;
  variant: string | null;
  createdAt: number;
}

/** Today's market per row (POST /api/cards/live-prices, the site's lib/server/livePrices.ts LivePrice). */
export interface LivePrice {
  cardId: string;
  market: number;
  suggested: number;
  flag?: { reason: string; fallback?: number };
  stale?: { days: number };
}

export async function fetchOwnedCards(): Promise<OwnedCard[]> {
  const { cards } = await api<{ cards: OwnedCard[] }>("/api/cards");
  return cards;
}

/** Same call the website's My Cards makes on load: today's market for every unsold row. */
export async function fetchLivePrices(): Promise<Record<string, LivePrice>> {
  const { prices } = await api<{ prices: LivePrice[] }>("/api/cards/live-prices", { method: "POST", body: {}, timeoutS: 30 });
  return Object.fromEntries(prices.map((p) => [p.cardId, p]));
}

/** Not Listed / Live / Ended / Sold, the website's own words. */
export type ShownStatus = "ready" | "live" | "ended" | "sold";
export function statusOf(c: OwnedCard): ShownStatus {
  if (c.status === "sold") return "sold";
  if (c.status === "listed") return c.ebayEndedAt ? "ended" : "live";
  return "ready";
}
export const STATUS_LABEL: Record<ShownStatus, string> = { ready: "Not Listed", live: "Live", ended: "Ended", sold: "Sold" };

/** The number a row shows, as the website's list does: the sale, else today's market, else the asking price. */
export function rowPrice(c: OwnedCard, live: Record<string, LivePrice>): { text: string; note: string | null } {
  if (c.soldPrice != null) return { text: formatMoney(c.soldPrice), note: null };
  const lp = live[c.id];
  if (lp?.flag) {
    const n = lp.flag.fallback && lp.flag.fallback > 0 ? lp.flag.fallback : c.price;
    return { text: formatMoney(n), note: PRICE_FLAG_NOTE };
  }
  if (lp && lp.market > 0) return { text: formatMoney(lp.market), note: null };
  return { text: c.price > 0 ? formatMoney(c.price) : "—", note: c.price > 0 ? null : "No market price yet" };
}

/** Set completion, as /api/cards/sets serves it (lib/server/setCompletion.ts). */
export interface MissingCard {
  id: string;
  name: string;
  number: string;
  label: string;
  imageUrl: string;
  imageLarge: string;
  price: number | null;
}
export interface SetProgress {
  setId: string;
  setName: string;
  releaseDate: string | null;
  owned: number;
  total: number;
  pct: number;
  missing: number;
  costToFinish: number;
  unpriced: number;
  cheapest: MissingCard[];
}
export async function fetchSetProgress(game: GameId): Promise<SetProgress[]> {
  const { sets } = await api<{ sets: SetProgress[] }>(`/api/cards/sets?game=${game}`, { timeoutS: 30 });
  return sets;
}
export async function fetchMissing(game: GameId, setId: string): Promise<MissingCard[]> {
  const { missing } = await api<{ missing: MissingCard[] }>(`/api/cards/sets?game=${game}&set=${encodeURIComponent(setId)}`, { timeoutS: 30 });
  return missing;
}

/** Insights, as /api/cards/insights serves them (lib/server/insights.ts). */
export interface InsightCard {
  id: string;
  name: string;
  setName: string;
  imageUrl: string;
  kind: "card" | "sealed";
  quantity: number;
  price: number;
  weekAgo: number | null;
}
export interface Mover extends InsightCard {
  delta: number;
  pct: number;
}
export interface Insights {
  game: GameId;
  holding: number;
  value: { now: number; weekAgo: number | null; monthAgo: number | null };
  gainers: Mover[];
  losers: Mover[];
  top: (InsightCard & { share: number })[];
  bySet: { name: string; value: number; count: number }[];
  split: Record<"live" | "draft" | "ended" | "sold", { count: number; value: number }>;
  leftOut: number;
}
export function fetchInsights(game: GameId): Promise<Insights> {
  return api<Insights>(`/api/cards/insights?game=${game}`, { timeoutS: 30 });
}

export { formatMoney };
