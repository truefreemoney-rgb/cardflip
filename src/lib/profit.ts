import { netAfterFees, POSTAGE_USD } from "@/lib/fees";

/**
 * Profit per card and the year-end sales report (09-27). Pure math shared
 * by the Inventory page, the report page, the CSV route and the test.
 *
 * profit = sold price − eBay fees (actual when recorded, else estimated)
 *          − postage − what the seller paid (cost basis).
 * A card with no cost entered is still counted, at cost $0, and flagged so
 * the report can say "N sales have no purchase price".
 */

export interface SaleLike {
  soldPrice: number | null;
  soldFees: number | null;
  soldAt: number | null;
  costBasis: number | null;
}

export interface SaleBreakdown {
  gross: number;
  fees: number;
  postage: number;
  cost: number;
  profit: number;
  feesActual: boolean;
  costKnown: boolean;
}

export function saleBreakdown(c: SaleLike): SaleBreakdown | null {
  if (c.soldPrice == null) return null;
  const gross = c.soldPrice;
  const fees = gross - netAfterFees(gross, c.soldFees);
  const cost = c.costBasis ?? 0;
  return {
    gross,
    fees,
    postage: POSTAGE_USD,
    cost,
    profit: gross - fees - POSTAGE_USD - cost,
    feesActual: c.soldFees != null,
    costKnown: c.costBasis != null,
  };
}

export interface YearTotals {
  year: number;
  sales: number;
  gross: number;
  fees: number;
  postage: number;
  cost: number;
  profit: number;
  /** Sales whose fee is still the estimate. */
  feesEstimated: number;
  /** Sales with no purchase price entered. */
  costMissing: number;
}

/** Eastern-year of a sale timestamp, so a Dec 31 11pm sale lands in the right tax year. */
export function saleYear(ts: number): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(ts));
}

export function yearTotals<T extends SaleLike>(cards: T[], year: number): YearTotals {
  const t: YearTotals = { year, sales: 0, gross: 0, fees: 0, postage: 0, cost: 0, profit: 0, feesEstimated: 0, costMissing: 0 };
  for (const c of cards) {
    if (c.soldAt == null || saleYear(c.soldAt) !== year) continue;
    const b = saleBreakdown(c);
    if (!b) continue;
    t.sales++;
    t.gross += b.gross;
    t.fees += b.fees;
    t.postage += b.postage;
    t.cost += b.cost;
    t.profit += b.profit;
    if (!b.feesActual) t.feesEstimated++;
    if (!b.costKnown) t.costMissing++;
  }
  return t;
}

/** Every year with at least one sale, newest first. */
export function saleYears(cards: SaleLike[]): number[] {
  const years = new Set<number>();
  for (const c of cards) if (c.soldAt != null && c.soldPrice != null) years.add(saleYear(c.soldAt));
  return [...years].sort((a, b) => b - a);
}

/** One CSV cell: quoted when it needs to be. */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
