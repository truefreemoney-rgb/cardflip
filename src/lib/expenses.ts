/**
 * Expense rows for the admin Money section: shape, cleaning, and the
 * per-month math. No server imports so the client editor and the test can
 * share it (server storage is lib/server/expenses.ts).
 */
export type Period = "month" | "year" | "once";
export const PERIODS: Period[] = ["month", "year", "once"];

export interface Expense {
  id: string;
  name: string;
  amountUsd: number;
  period: Period;
  note?: string;
  /** Chris has checked the amount. Seeded rows start false. */
  confirmed: boolean;
}

/** One clean row or null: name required, amount a finite non-negative number, period one of ours. */
export function normalizeExpense(raw: unknown): Expense | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
  if (!name) return null;
  const amount = typeof r.amountUsd === "number" ? r.amountUsd : Number(r.amountUsd);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const period = PERIODS.includes(r.period as Period) ? (r.period as Period) : "month";
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 40) : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "row";
  const note = typeof r.note === "string" ? r.note.trim().slice(0, 160) : "";
  return { id, name, amountUsd: Math.round(amount * 100) / 100, period, ...(note ? { note } : {}), confirmed: r.confirmed === true };
}

/** What a row costs per month: yearly / 12, one-offs 0. */
export function perMonth(e: Pick<Expense, "amountUsd" | "period">): number {
  if (e.period === "month") return e.amountUsd;
  if (e.period === "year") return e.amountUsd / 12;
  return 0;
}

/** Recurring monthly total (one-offs excluded), rounded to cents. */
export function monthlyTotal(list: Expense[]): number {
  return Math.round(list.reduce((s, e) => s + perMonth(e), 0) * 100) / 100;
}
