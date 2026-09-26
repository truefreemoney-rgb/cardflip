/**
 * THE pricing ladder. Every price and scan count a customer can see lives
 * here (Chris, 09-25: "we will probably play around with the pricing a lot
 * in the future ... remember where all the text changes on the website
 * live"). Pages, emails, the help bot, Stripe copy and the admin console
 * all read from this file; nothing else may hardcode a dollar amount or a
 * scan count. Safe for client and server imports (no secrets, no db).
 *
 * After a change: grep src for `\$\d` and `\d+ scans` to prove nothing is
 * hardcoded, run `npm run test:quota`, then update the Stripe product
 * descriptions + prices (scripts/stripe-sync-pricing.mjs) so Checkout says
 * the same thing the site does.
 */

export const PRICING = {
  /** Fresh account, no card: lifetime scans before the wall. */
  trial: { scans: 5 },
  /** One-time buy, no subscription. Never expires, stacks, every feature unlocked while scans remain. */
  pack: { price: 4.99, scans: 100 },
  /** The subscription. Scans per calendar month. */
  standard: { price: 9.99, scans: 250 },
  /** Volume tier. Scans per calendar month. */
  pro: { price: 19.99, scans: 750 },
  /** Referral: bonus scans banked by the referrer when an invited friend subscribes (Chris 09-26: one pack's worth). */
  referral: { scans: 100 },
} as const;

export type PaidPlan = "standard" | "pro";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-US");

/** "$9.99" */
export const PRICE = {
  pack: usd(PRICING.pack.price),
  standard: usd(PRICING.standard.price),
  pro: usd(PRICING.pro.price),
} as const;

/** "250", "2,000" */
export const SCANS = {
  trial: num(PRICING.trial.scans),
  pack: num(PRICING.pack.scans),
  standard: num(PRICING.standard.scans),
  pro: num(PRICING.pro.scans),
  referral: num(PRICING.referral.scans),
} as const;

/** "$9.99 a month" / "$4.99 one time" */
export const PRICE_LINE = {
  pack: `${PRICE.pack} one time`,
  standard: `${PRICE.standard} a month`,
  pro: `${PRICE.pro} a month`,
} as const;

/** "$9.99/mo" */
export const PRICE_SHORT = {
  standard: `${PRICE.standard}/mo`,
  pro: `${PRICE.pro}/mo`,
} as const;

export const PLAN_NAME = { trial: "Free trial", pack: "Scan Pack", standard: "CardFlip", pro: "Pro" } as const;

/** One sentence that states the whole ladder, for bots, emails and meta descriptions. */
export const LADDER_SENTENCE =
  `${SCANS.trial} scans free to start. Then a ${PRICE.pack} Scan Pack of ${SCANS.pack} scans with no subscription, ` +
  `or ${PRICE.standard} a month for ${SCANS.standard} scans, or Pro at ${PRICE.pro} a month for ${SCANS.pro}.`;
