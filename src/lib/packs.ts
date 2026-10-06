/**
 * Pack-opening tracker math (audit G8). Pure, so the server, the pages and the
 * share picture all read the same numbers (scripts/test-packs.mjs).
 *
 * A pull is worth its market price: scan_price (the plain-market figure the scanner stored when
 * the card was added, from quotePrice(..., "market") in lib/listing.ts) when there is one, else the
 * row's price. A pull that has since SOLD counts at what it sold for.
 */

export const PACK_NAME_MAX = 60;
/** A pack costs a few dollars to a few hundred; the cap only stops a typo from wrecking the lifetime ROI. */
export const PACK_COST_MAX = 100_000;

export interface PullRow {
  id: string;
  cardName: string;
  setName: string;
  imageUrl: string;
  status: string;
  price: number;
  scanPrice: number | null;
  soldPrice: number | null;
  quantity: number;
}

export interface Pull {
  id: string;
  cardName: string;
  setName: string;
  imageUrl: string;
  /** What the pull is worth, whole stack. */
  value: number;
}

export interface PackTotals {
  cost: number;
  value: number;
  /** value - cost. */
  profit: number;
  /** profit / cost, in percent; null when the pack was free (no sensible percentage). */
  roiPct: number | null;
  count: number;
  best: Pull | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function pullValue(row: Pick<PullRow, "status" | "price" | "scanPrice" | "soldPrice" | "quantity">): number {
  const each =
    row.status === "sold" && row.soldPrice != null && row.soldPrice > 0
      ? row.soldPrice
      : row.scanPrice != null && row.scanPrice > 0
        ? row.scanPrice
        : row.price;
  const qty = Math.max(1, row.quantity || 1);
  return r2((Number.isFinite(each) && each > 0 ? each : 0) * qty);
}

export function toPulls(rows: PullRow[]): Pull[] {
  return rows
    .map((r) => ({ id: r.id, cardName: r.cardName, setName: r.setName, imageUrl: r.imageUrl, value: pullValue(r) }))
    .sort((a, b) => b.value - a.value);
}

export function packTotals(cost: number, pulls: Pull[]): PackTotals {
  const safeCost = Number.isFinite(cost) && cost > 0 ? r2(cost) : 0;
  const value = r2(pulls.reduce((s, p) => s + p.value, 0));
  const profit = r2(value - safeCost);
  const best = pulls.reduce<Pull | null>((b, p) => (b == null || p.value > b.value ? p : b), null);
  return {
    cost: safeCost,
    value,
    profit,
    roiPct: safeCost > 0 ? Math.round((profit / safeCost) * 1000) / 10 : null,
    count: pulls.length,
    best: best && best.value > 0 ? best : null,
  };
}

/** Lifetime across packs: the sum of costs and values, one ROI over the lot. */
export function lifetimeTotals(packs: { cost: number; value: number; count: number }[]): {
  cost: number;
  value: number;
  profit: number;
  roiPct: number | null;
  packs: number;
  cards: number;
} {
  const cost = r2(packs.reduce((s, p) => s + p.cost, 0));
  const value = r2(packs.reduce((s, p) => s + p.value, 0));
  const profit = r2(value - cost);
  return {
    cost,
    value,
    profit,
    roiPct: cost > 0 ? Math.round((profit / cost) * 1000) / 10 : null,
    packs: packs.length,
    cards: packs.reduce((s, p) => s + p.count, 0),
  };
}

/** "+42%" / "-18%" / "Free Pack". */
export function roiLabel(roiPct: number | null): string {
  if (roiPct == null) return "Free Pack";
  return `${roiPct > 0 ? "+" : ""}${roiPct}%`;
}

/** Text colour for a gain (green), a loss (red) or flat (grey). */
export const gainClass = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-zinc-300");

/** The cost a request body carries: a finite number from 0 to the cap, rounded to cents; null = reject. */
export function parsePackCost(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > PACK_COST_MAX) return null;
  return r2(v);
}

export function parsePackName(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, PACK_NAME_MAX) : "";
}
