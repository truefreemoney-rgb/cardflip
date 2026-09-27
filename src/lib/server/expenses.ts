import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * What CardFlip pays for (Chris 09-27: "add all my expenses" to the Money
 * section). One JSON list in the settings table, edited on /admin/analytics;
 * seeded once from SEED_EXPENSES with Claude's best knowledge, every seed row
 * unconfirmed until Chris ticks it. Pure math lives in lib/expenses.ts so the
 * page and the test share it.
 */
export const EXPENSES_KEY = "expenses";
export { daysUntil, monthlyTotal, nextDue, normalizeExpense, type Expense, type Period } from "@/lib/expenses";
import { normalizeExpense, type Expense } from "@/lib/expenses";

/** Seeded once when the list does not exist yet. Amounts are Claude's best guess; Chris confirms in the console. */
export const SEED_EXPENSES: Expense[] = [
  { id: "vercel", name: "Vercel Pro", amountUsd: 20, period: "month", note: "Hosting + cron on the minute", confirmed: false },
  { id: "turso", name: "Turso Developer", amountUsd: 5.99, period: "month", note: "Database, since the 09-06 outage", confirmed: false },
  { id: "ipostal1", name: "iPostal1 mailbox", amountUsd: 9.99, period: "month", note: "Chevy Chase MD business address (Stripe)", confirmed: false },
  { id: "fastmail", name: "Fastmail", amountUsd: 5, period: "month", note: "support@cardflip.io mail", confirmed: false },
  { id: "domain", name: "cardflip.io domain", amountUsd: 35, period: "year", note: "Renewal", confirmed: false },
  { id: "x-api", name: "X API credits", amountUsd: 5, period: "once", note: "About 330 posts; recharge when posts 402", dueDate: "2026-09-25", confirmed: false },
  { id: "claude", name: "Claude Max (Anthropic)", amountUsd: 106.35, period: "month", note: "Chris's plan, tax included", dueDate: "2026-10-09", confirmed: false },
  { id: "anthropic-api-sep", name: "Anthropic API top-ups, Sep 2026", amountUsd: 42.58, period: "once", dueDate: "2026-09-10", note: "Four auto-reloads during the accuracy testing; site scans were $3.15 of it", confirmed: true },
];

export async function loadExpenses(): Promise<Expense[]> {
  const raw = await getSetting(EXPENSES_KEY);
  if (!raw) return SEED_EXPENSES.map((e) => ({ ...e }));
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeExpense).filter((e): e is Expense => e !== null);
  } catch {
    return [];
  }
}

export async function saveExpenses(list: unknown): Promise<Expense[]> {
  if (!Array.isArray(list)) throw new Error("expenses must be a list");
  const clean = list.map(normalizeExpense).filter((e): e is Expense => e !== null);
  if (clean.length > 100) throw new Error("too many rows");
  await setSetting(EXPENSES_KEY, JSON.stringify(clean));
  return clean;
}
