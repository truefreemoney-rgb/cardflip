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
export { monthlyTotal, normalizeExpense, type Expense, type Period } from "@/lib/expenses";
import { normalizeExpense, type Expense } from "@/lib/expenses";

/** Seeded once when the list does not exist yet. Amounts are Claude's best guess; Chris confirms in the console. */
export const SEED_EXPENSES: Expense[] = [
  { id: "vercel", name: "Vercel Pro", amountUsd: 20, period: "month", note: "Hosting + cron on the minute", confirmed: false },
  { id: "turso", name: "Turso Developer", amountUsd: 5.99, period: "month", note: "Database, since the 09-06 outage", confirmed: false },
  { id: "ipostal1", name: "iPostal1 mailbox", amountUsd: 9.99, period: "month", note: "Chevy Chase MD business address (Stripe)", confirmed: false },
  { id: "fastmail", name: "Fastmail", amountUsd: 5, period: "month", note: "support@cardflip.io mail", confirmed: false },
  { id: "domain", name: "cardflip.io domain", amountUsd: 35, period: "year", note: "Renewal", confirmed: false },
  { id: "x-api", name: "X API credits", amountUsd: 5, period: "once", note: "09-25, about 330 posts; recharge when posts 402", confirmed: false },
  { id: "claude", name: "Claude plan (Chris)", amountUsd: 0, period: "month", note: "Fill in your plan", confirmed: false },
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
