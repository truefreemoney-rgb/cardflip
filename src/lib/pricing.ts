/**
 * THE pricing ladder. Every price and scan count a customer can see lives
 * here (Chris, 09-25: "we will probably play around with the pricing a lot
 * in the future ... remember where all the text changes on the website
 * live"). Pages, emails, the help bot, Stripe copy and the admin console
 * all read from this file; nothing else may hardcode a dollar amount or a
 * scan count. Safe for client and server imports (no secrets, no db).
 *
 * After a change: grep src for `\$\d` and `\d+ scans` to prove nothing is
 * hardcoded, run `npm run test:quota` and `npm run test:rollover`, then edit
 * the Stripe product descriptions + prices in the Stripe dashboard (test AND
 * live mode; there is no sync script) so Checkout says the same thing the
 * site does. A NEW Stripe price id must also be added to PRICE_IDS below (or
 * set as STRIPE_PRICE_ID / STRIPE_PRO_PRICE_ID) before anyone pays it: an
 * invoice on an unknown price credits no scans and lands on the Errors page.
 */
import { currencyFor } from "@/lib/countries";

export const PRICING = {
  /** Fresh account, no card: lifetime scans before the wall. */
  trial: { scans: 5 },
  /** One-time buy, no subscription. Never expires, stacks, every feature unlocked while scans remain. */
  pack: { price: 4.99, scans: 100 },
  /** The subscription. Scans credited each time a payment clears (they stack, nothing resets). */
  standard: { price: 9.99, scans: 250 },
  /**
   * Volume tier. Scans credited each time a payment clears (they stack, nothing resets).
   * $24.99 from 09-30 (was $19.99, Chris: "go with A"): at 1.93 cents a scan a
   * fully used Pro earned the same dollars as Standard on twice the price; now
   * ~$9.32 a month vs Standard's ~$4.51, and still cheaper per scan (3.3 vs 4.0 cents).
   */
  pro: { price: 24.99, scans: 750 },
  /** Referral: bonus scans banked by the referrer when an invited friend subscribes (Chris 09-26: one pack's worth). */
  referral: { scans: 100 },
} as const;

/**
 * Local price points for the other open countries (Chris 09-30: every price
 * ends in .99; ≈ PRICING at the 09-30 ECB rate). NOT charged yet: Checkout
 * still bills the USD price above until matching Stripe prices exist per
 * currency. Keyed by ISO currency (lib/countries.ts COUNTRY_CURRENCY).
 */
export const LOCAL_PRICING = {
  CAD: { pack: 6.99, standard: 13.99, pro: 34.99 },
  GBP: { pack: 3.99, standard: 7.99, pro: 18.99 },
  EUR: { pack: 4.99, standard: 8.99, pro: 21.99 },
  AUD: { pack: 6.99, standard: 13.99, pro: 34.99 },
  NZD: { pack: 8.99, standard: 17.99, pro: 43.99 },
} as const;

export type LocalCurrency = keyof typeof LOCAL_PRICING;

/**
 * The currency Checkout bills in, from the account's HOME country (Chris
 * 09-30: prices follow home, never the IP). Lower-case for Stripe; null =
 * the USD price as before (US, legacy/unknown home). The live Stripe prices
 * carry these amounts as currency_options, so the price ids never change.
 */
export function checkoutCurrency(homeCountry: string | null | undefined): string | null {
  const cur = currencyFor(homeCountry);
  return cur in LOCAL_PRICING ? cur.toLowerCase() : null;
}

/** A plan's price in minor units of `currency` (any case); null when it is not a local currency. */
export function localPlanCents(plan: PaidPlan | "pack", currency: string | null | undefined): number | null {
  const cur = (currency ?? "").toUpperCase();
  return cur in LOCAL_PRICING ? Math.round(LOCAL_PRICING[cur as LocalCurrency][plan] * 100) : null;
}

/** "£7.99" / "CA$13.99" / "$9.99": what a viewer paying in `currency` sees (USD or unknown = PRICE). */
export function planPriceLabel(plan: PaidPlan | "pack", currency: string | null | undefined): string {
  const cents = localPlanCents(plan, currency);
  if (cents === null) return `$${PRICING[plan].price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency!.toUpperCase() }).format(cents / 100);
}

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

/**
 * Scan rollover (Chris, 09-30): scans arrive when a subscription payment
 * clears (users.plan_scans, lib/server/scanCredits.ts), unused scans stack,
 * and nothing resets on the 1st. One sentence so the pricing page, help
 * articles, the help bot, the welcome email and the FAQ all say the same thing.
 */
export const ROLLOVER_SENTENCE = "Unused scans carry over each month while your plan is active.";

/**
 * What ending a plan does to banked scans (Chris, 09-30): plan scans pause
 * (they stay on the account, usable only while subscribed) and come back on
 * resubscribe with the new payment stacking on top. Scan Pack scans are not
 * affected. Shared by the pricing FAQ, Terms, help, the help bot and the
 * account page, so nobody ever reads a promise the code does not keep.
 */
export const FROZEN_SENTENCE = "If your plan ends, the scans you have banked pause and come back when you resubscribe.";

/** The order scans are spent in, for the pages that explain bonus and pack scans. */
export const DRAW_ORDER_SENTENCE = "Scans are used in this order: plan scans first, then bonus scans from friends, then Scan Pack scans.";

export const ROLLOVER = {
  /**
   * Cap on banked plan scans, in months of the plan's own credit (2 = a Standard
   * subscriber tops out at 2 x 250). null = no cap: Chris's rule is that nobody
   * loses a scan they paid for. If set, it only limits NEW credits; scans
   * already banked are never taken back.
   */
  maxMonths: null as number | null,
};

/**
 * Every Stripe price id a subscription invoice can carry -> the plan it buys.
 * Scans credited are ALWAYS PRICING[plan].scans and cents are what the id was
 * sold for (only the proration maths needs them); an id that is not here or
 * in STRIPE_PRICE_ID / STRIPE_PRO_PRICE_ID credits nothing and is reported,
 * never guessed. Retired ids stay forever: an old subscriber can still be
 * billed on one (a retired Pro id credits today's Pro amount).
 */
export interface PriceIdEntry {
  plan: PaidPlan;
  cents: number;
  retired?: boolean;
  note: string;
}
export const PRICE_IDS: Record<string, PriceIdEntry> = {
  price_1UAjvlHrYyCaAIAxazDtv1Dz: { plan: "standard", cents: Math.round(PRICING.standard.price * 100), note: "live CardFlip $9.99/mo" },
  price_1UBwtjHrYyCaAIAxHtHBqUl7: { plan: "pro", cents: Math.round(PRICING.pro.price * 100), note: "live Pro $24.99/mo, archived 09-25, reactivated 09-30 for 750 scans" },
  price_1UJmWRHrYyCaAIAxR9eImYvs: { plan: "pro", cents: 1999, retired: true, note: "live Pro $19.99/mo, 09-25 to 09-30 (nobody was on it)" },
  price_1UAeGnHzaqR7o9G2jhQpe38h: { plan: "standard", cents: 999, retired: true, note: "sandbox-era CardFlip $9.99/mo (08-31)" },
};

/**
 * The plan, scans and price a Stripe price id stands for, or null when it is
 * unknown. `current` = the ids from the environment (STRIPE_PRICE_ID and
 * STRIPE_PRO_PRICE_ID), which win so test mode's ids work too.
 */
export function scansForPriceId(
  priceId: string | null | undefined,
  current: { standard?: string | null; pro?: string | null } = {},
): { plan: PaidPlan; scans: number; cents: number } | null {
  if (!priceId) return null;
  const plan: PaidPlan | null =
    current.pro && priceId === current.pro ? "pro" : current.standard && priceId === current.standard ? "standard" : (PRICE_IDS[priceId]?.plan ?? null);
  if (!plan) return null;
  const listed = PRICE_IDS[priceId];
  return { plan, scans: PRICING[plan].scans, cents: listed?.cents ?? Math.round(PRICING[plan].price * 100) };
}
