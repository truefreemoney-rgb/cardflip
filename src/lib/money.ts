import type { Currency } from "./types.ts";

/**
 * THE money formatter (review 10-19 design #21: six copies had drifted on grouping and decimals). Every price the app
 * prints goes through here: "$1,499.00" (grouped thousands, always cents; Chris: prices are always $X.XX). Kept in its own
 * tiny module so mail, push copy, admin pages and the pricing table can import it without the whole listing module.
 */
const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€" };

/**
 * Renders a price in its own currency. Cardmarket quotes euros, and showing
 * €4,184 as "$4,184" isn't a cosmetic slip — it invites a seller to list at a
 * number that was never dollars.
 */
export function formatMoney(value: number | null | undefined, currency: Currency = "USD"): string {
  if (value == null) return "—";
  // Grouped thousands: "$1,499.00" reads as a price, "$1499.00" as a typo.
  const digits = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${CURRENCY_SYMBOL[currency]}${digits}`;
}
