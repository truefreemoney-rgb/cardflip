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
 *  1. Cross-source referee (any price >= $10): TCG >= 10x Cardmarket -> no
 *     (since 10-06; it was 5x / 4x under $100, which hid Cresselia at $17 on
 *     a 5.4x gap with 140 steady days). TCG < 3x -> yes, stop (two sources
 *     agree, thin / flat / round no longer matter). Between 3x and 10x is
 *     inconclusive: Europe runs cheaper on old US holos and Cardmarket can be
 *     the wrong printing, so it only ever counts as one extra soft sign
 *     (test 6, and the under-$100 line below), never a verdict alone.
 *  2. A spike that never came back (>= $50): a one-step rise >= 3x and the
 *     price is still >= 3x the level before it (the higher of the 7- and
 *     30-point medians, so a short glitch-low that recovers is not a spike).
 *  3. Sibling anchor (>= $50): >= 3x EVERY other variant of the same card.
 *  4. Stuck listing (>= $100): the identical value for >= 45 days. No sale
 *     in six weeks means the market has not updated: since 10-02 a NOTE
 *     (`stale` = the days, hard false, the screens show the number with
 *     "Market hasn't updated this in N months"), not a hide; tests 5-6 do not
 *     run on top of it. For an OLD price (see `old`) it stays a hide.
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
 * Under $100 only tests 1-3 apply, plus one more: a 3-10x Cardmarket gap next
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
  /**
   * TCG >= this x Cardmarket: not ok on its own (10-06). Europe genuinely runs 3-5x cheaper on old US holos (Cresselia
   * Great Encounters: $17.23 steady 140 days against EUR 2.85), and a Cardmarket figure can simply be the wrong printing's
   * (Cresselia LV.X EUR 11.30 against $61.39), so a gap below this is only ONE soft sign, never a verdict by itself.
   */
  refExtreme: 10,
  /** TCG < this x Cardmarket: ok, stop. From here up to refExtreme is one soft sign (tests 1 and 6). */
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

/**
 * The step-jump rule for MOVERS (10-01 review, Skuntank Pokémon Rumble #13):
 * a "+71% this week" whose whole gain is ONE day's step after months of
 * standing still ($52.07-$52.69 for 4+ months, then $89.98 overnight, held
 * flat since) is a thin-market print, not a move a collector believes; it
 * sails through priceTrust because the price is under $100 (tests 1-3 only),
 * the step is under 3x and there is no second source. Used by the movers
 * pick only (social.ts), never by priceTrust(), so the card pages and the rest
 * of the site read the price exactly as before.
 *
 * A step jump is: a one-day rise >= stepMin (1.30x) inside the move's window,
 * still standing, after a flat stretch of >= flatDays (30) calendar days that
 * stayed within +-flatBand (3%) of the price the step started from, with no
 * confirmation. A second source confirms when Cardmarket's price already
 * stands within confirmLevel (1.5x) of the new TCGplayer price (the step is
 * catching up to a market that was already there), or its own series rose by
 * confirmMove (10%) over the window. A gradual climb (Gardevoir Ruby &
 * Sapphire 7: $57 -> 65 -> 69 -> 72 -> 75 -> 78 -> 106 over 4 months) has no
 * flat stretch before its last step, and a card with under 30 days of history
 * has nothing to call flat, so neither is flagged.
 */
export const STEP_JUMP = {
  /** A one-day rise of at least this x. */
  stepMin: 1.3,
  /** The price before the step stood within +- this of itself ... */
  flatBand: 0.03,
  /** ... for at least this many calendar days. */
  flatDays: 30,
  /** Confirmed when the TCGplayer price is <= this x Cardmarket (USD). */
  confirmLevel: 1.5,
  /** Confirmed when the Cardmarket series rose by at least this over the window. */
  confirmMove: 0.1,
} as const;

/** Magic's referee in SQL (mtg_cards has Scryfall's Cardmarket price on the row): the same numbers as test 1. */
export const MTG_REFEREE_SQL = `(price_eur IS NULL OR price_eur < ${PRICE_TRUST.refMinEur} OR price_usd < ${PRICE_TRUST.refExtreme} * ${PRICE_TRUST.eurToUsd} * price_eur)`;

export interface PriceTrustInput {
  /** The latest price being printed (USD): the price of THIS series, so the price shown is the price tested. */
  to: number;
  /** That series' daily prices, oldest first, null = no point; ends on the day `to` was read. */
  prices: readonly (number | null)[];
  /** Latest prices (USD) of the card's other variants. */
  siblings?: readonly number[];
  /** A fresh second-source price in EUR (Pokémon: Cardmarket average; Magic: Scryfall price_eur). Under EUR 1 it is ignored. */
  refEur?: number | null;
  /** Pokémon: TCGdex's Cardmarket avg (EUR, REF_ALT_SOURCE). Can only take a refEur gap away, never vouch or open one. */
  refAltEur?: number | null;
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
  /**
   * Test 4 as a NOTE, not a hide (10-02): the identical value for this many
   * calendar days (>= stuckDays) with no evidence it is wrong. The screens show
   * the number with "Market hasn't updated this in N months" (hard is false);
   * the social picks still skip it (ok is false). Charizard Plasma Storm 136:
   * $1,150 flat 128 days was a fair Near Mint price that the hide buried.
   */
  stale?: number;
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

/**
 * Pokémon's second Cardmarket reading (10-06): TCGdex's `avg`, kept for cards
 * whose pokemontcg.io average disagrees with the US price (source below,
 * variant "average", EUR). Either reading can be another printing's figure
 * (Cresselia LV.X: pokemontcg.io EUR 11.30, TCGdex EUR 49.70, US $61.39), and
 * either can be junk (Skyridge EUR 426 next to $36), so the one nearer the US
 * price referees: a second reading can only clear a gap, never open one.
 */
export const REF_ALT_SOURCE = "tcgdex-cm";

/** The usable reading (EUR, >= refMinEur) nearest `toUsd` in ratio, or null. */
export function nearestRef(toUsd: number | null, refs: readonly (number | null | undefined)[]): number | null {
  const usable = refs.filter((r): r is number => r != null && r >= PRICE_TRUST.refMinEur);
  if (usable.length === 0) return null;
  if (toUsd == null || !(toUsd > 0)) return usable[0];
  const off = (r: number) => Math.abs(Math.log(toUsd / (r * PRICE_TRUST.eurToUsd)));
  return usable.reduce((a, b) => (off(b) < off(a) ? b : a));
}

const x = (n: number) => `${n.toFixed(1)}x`;

export interface StepJumpInput {
  /** The series, oldest first, null = no point; its last slot is the day the price was read (pad a series that stops early). */
  prices: readonly (number | null)[];
  /** The move's window: a step counts when it landed inside the last `days` days. */
  days: number;
  /** Latest Cardmarket price in EUR (Pokémon average / Magic price_eur), if there is a fresh one. */
  refEur?: number | null;
  /** The Cardmarket EUR series, oldest first, ending about the same day (Pokémon only). */
  refPrices?: readonly (number | null)[] | null;
}

/** See STEP_JUMP: is the latest price a lone, unconfirmed one-day step out of a long flat stretch? `reason` says what it saw. */
export function stepJump({ prices, days, refEur = null, refPrices = null }: StepJumpInput, T: { [K in keyof typeof STEP_JUMP]: number } = STEP_JUMP): { jump: boolean; reason: string } {
  const none = { jump: false, reason: "" };
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
  if (n < 2) return none;
  const to = vals[n - 1];
  const windowStart = prices.length - 1 - days;
  for (let k = n - 1; k >= 1 && idx[k] > windowStart; k--) {
    const pre = vals[k - 1];
    const rise = vals[k] / pre;
    if (rise < T.stepMin) continue;
    if (to / pre < T.stepMin) continue; // the step has been given back
    let j = k - 1;
    while (j > 0 && Math.abs(vals[j - 1] / pre - 1) <= T.flatBand) j--;
    const flat = idx[k - 1] - idx[j] + 1;
    if (flat < T.flatDays) continue;
    // A second source that already stands near the new price, or moved the same way, confirms it.
    if (refEur != null && refEur >= PRICE_TRUST.refMinEur && to <= T.confirmLevel * PRICE_TRUST.eurToUsd * refEur) continue;
    if (refPrices) {
      const cmNow = lastPriced(refPrices);
      let cmThen: number | null = null;
      for (let i = refPrices.length - 1 - days; i >= 0 && cmThen == null; i--) cmThen = refPrices[i];
      if (cmNow != null && cmThen != null && cmNow / cmThen - 1 >= T.confirmMove) continue;
    }
    return { jump: true, reason: `step ${x(rise)} in one day after ${flat}d flat` };
  }
  return none;
}



/** ok = the price may be printed; reason says why not (or, when a second source vouched, that it did). */
export function priceTrust({ to, prices, siblings = [], refEur = null, refAltEur = null, vintage = false, old = false }: PriceTrustInput): PriceTrust {
  const T = PRICE_TRUST;
  if (!(to > 0)) return { ok: false, hard: true, reason: "no price" };
  // Nothing below $10 is worth a second look: the mover and pool floors sit there.
  if (to < T.refMinUsd) return { ok: true, reason: "" };
  const wrong = (reason: string): PriceTrust => ({ ok: false, hard: true, reason });

  // 1. Cross-source referee. The second reading speaks only when nearer than the first, and then it never vouches:
  // a junk TCGdex EUR 2,216 must not wave through the $1,013 Rayquaza spike, so an agreeing second reading only
  // takes the gap away and the series tests below still run.
  let refRatio: number | null = null;
  const primary = refEur != null && refEur >= T.refMinEur ? refEur : null;
  const ref = primary == null ? null : nearestRef(to, [primary, refAltEur]);
  if (ref != null) {
    refRatio = to / (ref * T.eurToUsd);
    if (refRatio >= T.refExtreme) return wrong(`cardmarket ${x(refRatio)}`);
    if (refRatio < T.refClear) {
      if (ref === primary) return { ok: true, reason: `cardmarket ${x(refRatio)} agrees`, agrees: true };
      refRatio = null;
    }
  }

  const f = features(prices, to);
  // 2. A spike that never came back.
  if (to >= T.spikeMinUsd && f.hardSpike) return wrong(`spike ${x(f.hardSpike[0])} still ${x(f.hardSpike[1])}`);
  // 3. Sibling anchor.
  const sib = siblings.reduce((m, v) => (v > m ? v : m), 0);
  const sibRatio = sib > 0 ? to / sib : null;
  if (to >= T.spikeMinUsd && sibRatio != null && sibRatio >= T.siblingFail) return wrong(`sibling ${x(sibRatio)}`);
  // 4. Stuck listing. An OLD price is stale sooner, and from $10: a parked $15.50 that "dropped" to $10 is not a drop, so it is wrong.
  if (old && to >= T.refMinUsd && f.runDays >= T.staleOldDays) return wrong(`flat ${f.runDays}d`);
  // A CURRENT price flat >= 45 days is a note, not a hide (10-02): no sale in six weeks says the market has not updated, not that the
  // number is wrong (Charizard Plasma Storm 136: $1,150 flat 128 days, eBay Near Mint sold $1,276-$1,651). Tests 1-3 above still hide it
  // when there is evidence; a 3-5x Cardmarket gap is named in the reason but does not hide it either (Europe runs far cheaper on US
  // chase cards). The soft signs (thin, round) are the same statement as flat, so they do not run on top of it.
  if (to >= T.gradedMinUsd && f.runDays >= T.stuckDays) {
    return { ok: false, hard: false, stale: f.runDays, reason: [`flat ${f.runDays}d`, ...(refRatio != null ? [`cardmarket ${x(refRatio)}`] : [])].join(", ") };
  }

  const thin = f.k30 <= T.thinChanges || f.runDays >= T.thinFlatDays;
  if (to < T.gradedMinUsd) {
    // Only a 3-10x gap gets here; it counts as one sign, next to one more (thin or unverifiable) it is enough.
    if (refRatio != null && (thin || f.n < T.minPricedDays)) {
      return { ok: false, hard: false, reason: [thin ? "thin" : `${f.n} priced days`, `cardmarket ${x(refRatio)}`].join(", ") };
    }
    return { ok: true, reason: "" };
  }
  // 5. A fresh doubling nobody confirmed (a second source that agreed already returned above).
  if (f.doubled > 0) return wrong(`doubled ${x(f.doubled)} in the last ${T.doubleWindow} priced days`);
  // 6. Graded evidence. From $500 thin and round are a vintage print's ordinary state (a 1st Edition Charizard is one flat, round $10,000), so they are no sign there,
  // unless a second source disagrees (a 3-10x Cardmarket gap): then nothing excuses them.
  const signs: string[] = [];
  if (!(vintage && !old && to >= T.softOneMinUsd && refRatio == null)) {
    if (thin) signs.push("thin");
    if (isRoundPrice(to)) signs.push("round");
  }
  if (sibRatio != null && sibRatio >= T.siblingSoft) signs.push(`sibling ${x(sibRatio)}`);
  if (f.softSpike) signs.push("spike");
  if (f.n < T.minPricedDays) signs.push(`${f.n} priced days`);
  // A 3-10x gap is one more sign, never a sign on its own.
  const gap = refRatio != null ? [`cardmarket ${x(refRatio)}`] : [];
  const fail = signs.length >= (to >= T.softOneMinUsd ? T.softNeedBig : T.softNeed);
  if (fail || (signs.length >= 1 && signs.length + gap.length >= T.softNeed)) {
    return { ok: false, hard: false, reason: [...signs, ...gap].join(", ") };
  }
  return { ok: true, reason: "" };
}