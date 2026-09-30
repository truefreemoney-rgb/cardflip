/**
 * Is this card's latest TCGplayer price real? (Social price guard, 09-30.)
 *
 * TCGplayer's market price is one number from a thin market: Call of Legends
 * Rayquaza sat at $105 for months, jumped x5 in a day and now reads $1,013
 * while Cardmarket averages EUR 45; a Deoxys holo has been exactly $500 for
 * 87 days. A post that prints those is junk a collector spots at once, so
 * every path that prints a price asks this first (social.ts freshSeries and
 * the stage cards today, the card pages and listing suggestions next).
 *
 * Pure and DB-free: the caller loads the series, the card's other variants
 * and a fresh second-source price, and gets ok / not ok plus a short reason.
 * The numbers were calibrated on the whole 09-30 Pokémon pool (4,688 fresh
 * cards >= $10): the rule removes 8.3% of it, 0 of the 319 cards whose two
 * sources agree (< 2x), and lands on the cards a collector calls junk. A
 * slightly smaller pool is always fine; a junk price is not.
 *
 * Order of tests, first hit decides:
 *  1. Cross-source referee (any price >= $10): TCG >= 5x Cardmarket -> no
 *     (>= 4x under $100, where the soft signs below do not run). TCG < 3x ->
 *     yes, stop (two sources agree, thin / flat / round no longer matter).
 *     Between is inconclusive: real vintage and thin-market fluff both live
 *     there, so it only ever counts as one extra soft sign (test 6).
 *  2. A spike that never came back (>= $50): a one-step rise >= 3x and the
 *     price is still >= 3x the level before it (the higher of the 7- and
 *     30-point medians, so a short glitch-low that recovers is not a spike).
 *  3. Sibling anchor (>= $50): >= 3x EVERY other variant of the same card.
 *  4. Stuck listing (>= $100): the identical value for >= 45 days. No sale
 *     in six weeks is a listing, not a market price.
 *  5. A fresh doubling (>= $100): a one-step rise >= 2x inside the last 10
 *     priced points that the price still stands >= 2x above, with no agreeing
 *     second source (Machamp $64 -> $146). A recovery from a short glitch-low
 *     is not one (the price already traded there).
 *  6. Soft signs (>= $100): thin (<= 2 price changes in 30 days, or flat
 *     >= 21 days), a round number, >= 2x a sibling, a one-step 2x rise still
 *     >= 2x, or fewer than 14 priced days (unverifiable). $100-$499 needs 2,
 *     >= $500 needs 1: the more a card claims, the more evidence it needs.
 *     From $500 a vintage card (1st Edition, pre-2010 set) with no Cardmarket
 *     gap does not count thin or round: a flat, round $10,000 is what a 1st
 *     Edition Charizard looks like, and a modern $900 card that trades twice
 *     a month is not (it stays "unverified"). A Cardmarket gap adds one sign,
 *     but only next to another sign, and then nothing is excused.
 * Under $100 only tests 1-3 apply, plus one more: a 3-4x Cardmarket gap next
 * to a thin or unverifiable series (a $98 Pikachu at 3.8x with 3 priced days).
 *
 * `old` judges a price that is printed as the OLD side of a move ("$662 ->
 * $345"): a stale or thin old price is not a market price, so it is the
 * strictest reading: flat >= 30 days is stale from $10, and thin or round
 * alone fail from $500. The card pages call it without `old`.
 */

/** The thresholds, in one place so the site can read the same numbers. */
export const PRICE_TRUST = {
  /** Cardmarket is quoted in EUR; the rule compares in USD at this rate. */
  eurToUsd: 1.1,
  /** A second-source price under this (EUR) is a glitch (EUR 0.02 values exist), not a referee. */
  refMinEur: 1,
  /** A Cardmarket series not updated within this many days is too old to referee (it moves slowly, so 45 is still fine). */
  refMaxAgeDays: 45,
  /** Referee applies from here up. */
  refMinUsd: 10,
  /** TCG >= this x Cardmarket: not ok. */
  refFail: 5,
  /** The same under gradedMinUsd, where no soft sign runs to back up an inconclusive gap. */
  refFailLow: 4,
  /** TCG < this x Cardmarket: ok, stop. Between the two is inconclusive. */
  refClear: 3,
  /** Tests 2 and 3 apply from here up. */
  spikeMinUsd: 50,
  /** Test 2: a one-step rise >= this x ... */
  spikeRise: 3,
  /** ... whose price is still >= this x the pre-jump median. */
  spikeHold: 3,
  /** Points before the jump the short median is taken over ... */
  spikeLookback: 7,
  /** ... and the long one: the level before a jump is the higher of the two. */
  spikeLookbackLong: 30,
  /** A rise is a recovery, not a spike, when at least `recoverPoints` of the previous `recoverLookback` priced points were already >= `recoverFrac` x the price now. */
  recoverLookback: 60,
  recoverFrac: 0.7,
  recoverPoints: 2,
  /** Test 3: >= this x every other variant. */
  siblingFail: 3,
  /** Tests 4 and 5 apply from here up. */
  gradedMinUsd: 100,
  /** Test 4: identical value this many calendar days. */
  stuckDays: 45,
  /** `old` prices: identical this many calendar days is stale, from refMinUsd up. */
  staleOldDays: 30,
  /** Test 5: a one-step rise that the price is still >= this x above the level before it, inside the last `doubleWindow` priced points, to gradedMinUsd or more. */
  doubleRise: 2,
  doubleWindow: 10,
  /** Soft: thin = at most this many price changes in the last 30 days ... */
  thinChanges: 2,
  /** ... or flat this many days. */
  thinFlatDays: 21,
  /** Soft: >= this x a sibling. */
  siblingSoft: 2,
  /** Soft: a rise of this x still held at this x (half the hard spike). */
  softSpike: 2,
  /** Soft: fewer priced days than this is unverifiable. */
  minPricedDays: 14,
  /** Soft signs needed at $100-$499, and from softOneMinUsd up. */
  softNeed: 2,
  softNeedBig: 1,
  softOneMinUsd: 500,
  /** Sets released before this are vintage (thin and round are their normal state). */
  vintageBefore: "2010-01-01",
} as const;

/** Magic's referee in SQL (mtg_cards has Scryfall's Cardmarket price on the row): the same numbers as test 1. */
export const MTG_REFEREE_SQL = `(price_eur IS NULL OR price_eur < ${PRICE_TRUST.refMinEur} OR price_usd < CASE WHEN price_usd < ${PRICE_TRUST.gradedMinUsd} THEN ${PRICE_TRUST.refFailLow} ELSE ${PRICE_TRUST.refFail} END * ${PRICE_TRUST.eurToUsd} * price_eur)`;

export interface PriceTrustInput {
  /** The latest price being printed (USD): the price of THIS series, so the price shown is the price tested. */
  to: number;
  /** That series' daily prices, oldest first, null = no point; ends on the day `to` was read. */
  prices: readonly (number | null)[];
  /** Latest prices (USD) of the card's other variants. */
  siblings?: readonly number[];
  /** A fresh second-source price in EUR (Pokémon: Cardmarket average; Magic: Scryfall price_eur). Under EUR 1 it is ignored. */
  refEur?: number | null;
  /** The print is vintage (isVintage): thin and round are its normal state, not signs. */
  vintage?: boolean;
  /** The price is printed as the OLD side of a move (or another past reading): judged strictest, see the header. */
  old?: boolean;
}

export interface PriceTrust {
  ok: boolean;
  /** Short, for logs: why it failed, or what vouched for it ("" when nothing was needed). */
  reason: string;
  /** Set when not ok: true = evidence the price is wrong (test 1-5), false = only unverified (soft signs), so a page can say "unverified" instead of hiding the card. */
  hard?: boolean;
  /** A second source priced the card within 3x and vouched for it (test 1). A move a caller finds suspicious is still believable when this is set. */
  agrees?: boolean;
}

interface Features {
  /** Priced days. */
  n: number;
  /** Calendar span (days, inclusive) of the trailing run of the identical value. */
  runDays: number;
  /** Value changes among priced days in the last 30 calendar days. */
  k30: number;
  /** Any one-step rise >= spikeRise that still holds >= spikeHold x the pre-jump median: the worst such [rise, hold]. */
  hardSpike: [number, number] | null;
  /** Same at the soft thresholds. */
  softSpike: boolean;
  /** The biggest one-step rise >= doubleRise among the last doubleWindow priced points (0 = none). */
  doubled: number;
}

function median(sorted: number[]): number {
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function features(prices: readonly (number | null)[], to: number): Features {
  const idx: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    const v = prices[i];
    if (v != null) {
      idx.push(i);
      vals.push(v);
    }
  }
  const n = vals.length;
  let run = 0;
  while (run < n && vals[n - 1 - run] === to) run++;
  const runDays = run > 0 ? idx[n - 1] - idx[n - run] + 1 : 0;

  let k30 = 0;
  let prev: number | null = null;
  for (const v of prices.slice(-30)) {
    if (v == null) continue;
    if (prev != null && v !== prev) k30++;
    prev = v;
  }

  let hardSpike: [number, number] | null = null;
  let softSpike = false;
  let doubled = 0;
  for (let k = 1; k < n; k++) {
    const rise = vals[k] / vals[k - 1];
    if (rise < PRICE_TRUST.softSpike) continue;
    // A recovery is not a spike: the price already traded at about this level (1st Ed Ho-oh $350 -> $72 -> $350 ...).
    const back = vals.slice(Math.max(0, k - PRICE_TRUST.recoverLookback), k);
    if (back.filter((v) => v >= PRICE_TRUST.recoverFrac * to).length >= PRICE_TRUST.recoverPoints) continue;
    // The level before the jump: a 4-10 day glitch-low that recovers (1st Ed Lugia $1,085 -> $165 -> $1,135) is not
    // a spike, so the short median is never allowed to be lower than the month before it.
    const med7 = median(vals.slice(Math.max(0, k - PRICE_TRUST.spikeLookback), k).sort((a, b) => a - b));
    const med30 = median(back.slice(-PRICE_TRUST.spikeLookbackLong).sort((a, b) => a - b));
    const hold = to / Math.max(med7, med30);
    if (hold >= PRICE_TRUST.softSpike) softSpike = true;
    if (hold >= PRICE_TRUST.doubleRise && k >= n - PRICE_TRUST.doubleWindow) doubled = Math.max(doubled, rise);
    if (rise >= PRICE_TRUST.spikeRise && hold >= PRICE_TRUST.spikeHold && (!hardSpike || hold > hardSpike[1])) hardSpike = [rise, hold];
  }
  return { n, runDays, k30, hardSpike, softSpike, doubled };
}

/** Vintage print: a 1st Edition variant, or a set released before 2010 (release date "YYYY-MM-DD" or "YYYY/MM/DD"; "" = unknown). */
export function isVintage(variant: string, releaseDate = ""): boolean {
  if (variant.startsWith("1stEdition")) return true;
  const d = releaseDate.replace(/\//g, "-");
  return d !== "" && d < PRICE_TRUST.vintageBefore;
}

/** Round money is a listing, not a sale: whole numbers divisible by 5 and the x4.99 / x9.99 / x4.95 / x9.95 endings, from $100 up. */
export function isRoundPrice(price: number): boolean {
  if (price < PRICE_TRUST.gradedMinUsd) return false;
  if (Number.isInteger(price) && price % 5 === 0) return true;
  return /[49]\.(99|95)$/.test(price.toFixed(2));
}

/** The last priced value of a series (a second source's latest reading). */
export function lastPriced(prices: readonly (number | null)[]): number | null {
  for (let i = prices.length - 1; i >= 0; i--) if (prices[i] != null) return prices[i];
  return null;
}

const x = (n: number) => `${n.toFixed(1)}x`;



/** ok = the price may be printed; reason says why not (or, when a second source vouched, that it did). */
export function priceTrust({ to, prices, siblings = [], refEur = null, vintage = false, old = false }: PriceTrustInput): PriceTrust {
  const T = PRICE_TRUST;
  if (!(to > 0)) return { ok: false, hard: true, reason: "no price" };
  // Nothing below $10 is worth a second look: the mover and pool floors sit there.
  if (to < T.refMinUsd) return { ok: true, reason: "" };
  const wrong = (reason: string): PriceTrust => ({ ok: false, hard: true, reason });

  // 1. Cross-source referee.
  let refRatio: number | null = null;
  if (refEur != null && refEur >= T.refMinEur) {
    refRatio = to / (refEur * T.eurToUsd);
    if (refRatio >= (to >= T.gradedMinUsd ? T.refFail : T.refFailLow)) return wrong(`cardmarket ${x(refRatio)}`);
    if (refRatio < T.refClear) return { ok: true, reason: `cardmarket ${x(refRatio)} agrees`, agrees: true };
  }

  const f = features(prices, to);
  // 2. A spike that never came back.
  if (to >= T.spikeMinUsd && f.hardSpike) return wrong(`spike ${x(f.hardSpike[0])} still ${x(f.hardSpike[1])}`);
  // 3. Sibling anchor.
  const sib = siblings.reduce((m, v) => (v > m ? v : m), 0);
  const sibRatio = sib > 0 ? to / sib : null;
  if (to >= T.spikeMinUsd && sibRatio != null && sibRatio >= T.siblingFail) return wrong(`sibling ${x(sibRatio)}`);
  // 4. Stuck listing (an old price is stale sooner, and from $10: a parked $15.50 that "dropped" to $10 is not a drop).
  if (to >= (old ? T.refMinUsd : T.gradedMinUsd) && f.runDays >= (old ? T.staleOldDays : T.stuckDays)) return wrong(`flat ${f.runDays}d`);

  const thin = f.k30 <= T.thinChanges || f.runDays >= T.thinFlatDays;
  if (to < T.gradedMinUsd) {
    // Only a 3-4x gap gets here; it counts as one sign, next to one more (thin or unverifiable) it is enough.
    if (refRatio != null && (thin || f.n < T.minPricedDays)) {
      return { ok: false, hard: false, reason: [thin ? "thin" : `${f.n} priced days`, `cardmarket ${x(refRatio)}`].join(", ") };
    }
    return { ok: true, reason: "" };
  }
  // 5. A fresh doubling nobody confirmed (a second source that agreed already returned above).
  if (f.doubled > 0) return wrong(`doubled ${x(f.doubled)} in the last ${T.doubleWindow} priced days`);
  // 6. Graded evidence. From $500 thin and round are a vintage print's ordinary state (a 1st Edition Charizard is one flat, round $10,000), so they are no sign there,
  // unless a second source disagrees (a 3-5x Cardmarket gap): then nothing excuses them.
  const signs: string[] = [];
  if (!(vintage && !old && to >= T.softOneMinUsd && refRatio == null)) {
    if (thin) signs.push("thin");
    if (isRoundPrice(to)) signs.push("round");
  }
  if (sibRatio != null && sibRatio >= T.siblingSoft) signs.push(`sibling ${x(sibRatio)}`);
  if (f.softSpike) signs.push("spike");
  if (f.n < T.minPricedDays) signs.push(`${f.n} priced days`);
  // A 3-5x gap is one more sign, never a sign on its own.
  const gap = refRatio != null ? [`cardmarket ${x(refRatio)}`] : [];
  const fail = signs.length >= (to >= T.softOneMinUsd ? T.softNeedBig : T.softNeed);
  if (fail || (signs.length >= 1 && signs.length + gap.length >= T.softNeed)) {
    return { ok: false, hard: false, reason: [...signs, ...gap].join(", ") };
  }
  return { ok: true, reason: "" };
}