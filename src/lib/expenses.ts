/**
 * Expense rows for the admin Money section: shape, cleaning, and the
 * per-month math. No server imports so the client editor and the test can
 * share it (server storage is lib/server/expenses.ts).
 */
// Relative ./time.ts (not @/lib/time) so plain node resolves it — see cronSchedule.ts.
import { etDay } from "./time.ts";

export type Period = "month" | "year" | "once";
export const PERIODS: Period[] = ["month", "year", "once"];

export interface Expense {
  id: string;
  name: string;
  amountUsd: number;
  period: Period;
  note?: string;
  /** A day it is (or was) billed, YYYY-MM-DD. Recurring rows roll forward from it (nextDue). */
  dueDate?: string;
  /** The service's billing page (Chris 10-04: "so i can refer to it easily"). http(s) only. */
  billingUrl?: string;
  /** Chris has checked the amount. Seeded rows start false. */
  confirmed: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The next billing day on or after `now` (Eastern days): monthly rows step a
 * month at a time from dueDate, yearly rows a year, one-offs keep their date
 * (past or not). Null without a date. A 31st steps to the last day of shorter
 * months, the way card issuers do.
 */
export function nextDue(e: Pick<Expense, "dueDate" | "period">, now: Date = new Date()): string | null {
  if (!e.dueDate || !DATE_RE.test(e.dueDate)) return null;
  const today = etDay(now);
  if (e.period === "once" || e.dueDate >= today) return e.dueDate;
  const [y, m, d] = e.dueDate.split("-").map(Number);
  const stepMonths = e.period === "year" ? 12 : 1;
  for (let i = 1; i < 1200; i++) {
    const months = m - 1 + i * stepMonths;
    const yy = y + Math.floor(months / 12);
    const mm = months % 12;
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const candidate = isoDay(new Date(Date.UTC(yy, mm, Math.min(d, last))));
    if (candidate >= today) return candidate;
  }
  return null;
}

/** Calendar days from today (the Eastern day of `now`) to an ISO day; negative = past. */
export function daysUntil(day: string, now: Date = new Date()): number {
  const utcMidnight = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utcMidnight(day) - utcMidnight(etDay(now))) / 86_400_000);
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
  const dueDate = typeof r.dueDate === "string" && DATE_RE.test(r.dueDate) ? r.dueDate : "";
  const billingUrl = cleanUrl(r.billingUrl);
  return {
    id,
    name,
    amountUsd: Math.round(amount * 100) / 100,
    period,
    ...(note ? { note } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(billingUrl ? { billingUrl } : {}),
    confirmed: r.confirmed === true,
  };
}

/** A pasted billing link: trimmed, "https://" added when the scheme is missing, anything but http(s) dropped. */
export function cleanUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim().slice(0, 300);
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
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
