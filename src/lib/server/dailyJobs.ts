import { db } from "@/lib/db";
import { reconcilePaidInvoices, type ReconcileResult } from "@/lib/server/billingCredits";
import { syncEbaySales } from "@/lib/server/ebayOrders";
import { syncEndedEbayListings } from "@/lib/server/ebayListings";
import { syncEbayFees } from "@/lib/server/ebayFinances";
import { sendPushToUser } from "@/lib/server/push";
import { soldPush } from "@/lib/pushMessages";
import { sweepWishlistAlerts } from "@/lib/server/wishlistAlerts";
import { sweepWeeklyDigest } from "@/lib/server/digest";
import { sweepCardAlerts } from "@/lib/server/cardAlerts";
import { sweepAutoOffers } from "@/lib/server/ebayNegotiation";
import { refreshMtgPricesFromBulk } from "@/lib/server/mtgPriceRefresh";
import { withDbRetry } from "@/lib/server/priceBulkWrite";
import { sweepPriceHistory } from "@/lib/server/priceHistory";
import { hasTcgplayerMap, refreshPokemonPricesFromTcgcsv } from "@/lib/server/pokemonPriceRefresh";
import { scanSealedProducts } from "@/lib/server/sealedPrices";
import { refreshTcgPrices, type TcgRefreshResult } from "@/lib/server/tcgPriceRefresh";
import { runLogCleanupIfDue, type CleanupResult } from "@/lib/server/logCleanup";
import type { TcgGame } from "@/lib/server/tcgCards";

/**
 * The once-a-day maintenance run that keeps the charts moving:
 *   0. Stripe reconcile: credit any paid subscription invoice whose
 *      invoice.paid webhook never arrived (rides with steps 2+3+5, below)
 *   1. Magic prices from Scryfall's bulk file (mirror + history point)
 *   2. Pokémon points for every mapped card from TCGCSV (TCGplayer daily)
 *   3. Pokémon sweep of held / recently looked-up cards via pokemontcg.io
 *      (adds Cardmarket EUR and covers cards TCGCSV doesn't map)
 *   4. (Backups moved off the app: scripts/backup-turso.mjs dumps Turso nightly from Chris's PC.)
 *   5. eBay sales sweep for every seller with live listings, so sold cards
 *      flip even when the seller doesn't open the app (lib/server/ebayOrders.ts)
 *
 * Triggered from three places, all funnelled through `runDailyIfDue` so it
 * can never double-run:
 *   - an hourly timer while the machine is awake (instrumentation.ts)
 *   - the /api/auth/me heartbeat (any app page load, via after())
 *   - GET /api/cron/daily?key=CRON_SECRET for an external pinger, which is
 *     what covers a zero-traffic day on a scale-to-zero machine.
 * "Due" = last successful finish > 20h ago, or a run that started > 10 min
 * ago and never finished (killed mid-way — resume).
 *
 * `running` is per-process; on Vercel each invocation is its own process, so
 * the meta row is the only cross-process signal. A run killed by the
 * platform (the admin "Run now" after() before maxDuration was set, 09-09)
 * left daily_started_at newer than daily_finished_at, and the console showed
 * "running" for the old 45-min window. No invocation outlives maxDuration
 * (300s), so a start older than 10 min with no later finish is a dead run:
 * status reports it as not running and dailyDue stops deferring to it.
 */

const META = {
  started: "daily_started_at",
  finished: "daily_finished_at",
  lastResult: "daily_last_result",
};
const DUE_AFTER_MS = 20 * 60 * 60 * 1000;
/** A start with no finish older than this is a killed run, not a live one. */
const STALE_START_MS = 10 * 60 * 1000;
let running = false;

// Retried like the bulk writes (09-30: the result write after the Magic run is
// what threw the IOERR onto the Errors page); INSERT OR REPLACE is idempotent.
async function metaGet(key: string): Promise<string | null> {
  const row = (await withDbRetry(() => db.prepare("SELECT value FROM price_history_meta WHERE key = ?").get(key))) as { value: string } | undefined;
  return row?.value ?? null;
}
async function metaSet(key: string, value: string): Promise<void> {
  await withDbRetry(() => db.prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)").run(key, value));
}

/** True while another process's run is plausibly still going. */
export function inFlight(started: number, finished: number, now: number): boolean {
  return started > finished && now - started < STALE_START_MS;
}

export async function dailyDue(now = Date.now()): Promise<boolean> {
  if (running) return false;
  const finished = Number((await metaGet(META.finished)) ?? 0);
  const started = Number((await metaGet(META.started)) ?? 0);
  if (inFlight(started, finished, now)) return false;
  if (now - finished > DUE_AFTER_MS && now - started > STALE_START_MS) return true;
  return false;
}

export async function dailyStatus(now = Date.now()) {
  const startedAt = Number((await metaGet(META.started)) ?? 0) || null;
  const finishedAt = Number((await metaGet(META.finished)) ?? 0) || null;
  return {
    running: running || inFlight(startedAt ?? 0, finishedAt ?? 0, now),
    startedAt,
    finishedAt,
    lastResult: await metaGet(META.lastResult),
  };
}

export interface DailyResult {
  ran: boolean;
  mtg?: { scanned: number; updated: number; seriesTouched: number; mirrorChanged?: number; seriesSkipped?: number; tcgplayerFilled?: number } | { error: string } | { skipped: string };
  /** Lorcana / One Piece / Yu-Gi-Oh! daily prices + history (lib/server/tcgPriceRefresh.ts). */
  tcg?: Partial<Record<TcgGame, TcgRefreshResult | { error: string }>>;
  pokemonTcgcsv?:
    | { groups: number; groupsFailed: number; seriesTouched: number; sealedSeries?: number; sealedScan?: { groupsScanned: number; groupsFailed: number; products: number } | { error: string } }
    | { error: string }
    | { skipped: string };
  pokemon?: { recorded: number } | { error: string };
  ebaySales?: { sellers: number; sold: number; endedListings: number } | { error: string };
  ebayFees?: { sellers: number; filled: number } | { error: string };
  wishlistAlerts?: { checked: number; sent: number } | { error: string };
  cardAlerts?: { checked: number; sent: number; nudged: number } | { error: string };
  weeklyDigest?: { skipped?: string; users: number; sent: number } | { error: string };
  autoOffers?: { sellers: number; sent: number; failed: number } | { error: string };
  /** Missed-webhook catch-up: paid Stripe invoices with no scan credit (lib/server/billingCredits.ts). */
  billingReconcile?: ReconcileResult | { error: string };
  /** Weekly retention pass (lib/server/logCleanup.ts); recorded so a run that never stamps shows why. */
  logCleanup?: CleanupResult;
  ms?: number;
}

/**
 * Step 1 alone: Magic prices from Scryfall's bulk file. Never throws.
 * `skipIfDone` (the cron routes): a day already finished returns at once, so
 * the second, later cron (vercel.json, 09-30) only does work when the first
 * run died — and then resumes (planMtgWrites skips what it already wrote).
 */
export async function runMtgStep({ skipIfDone = false, now = Date.now() } = {}): Promise<NonNullable<DailyResult["mtg"]>> {
  try {
    if (skipIfDone) {
      const finished = Number((await metaGet(META.finished)) ?? 0);
      if (finished && new Date(finished).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) {
        return { skipped: "already finished today" };
      }
    }
    const r = await refreshMtgPricesFromBulk();
    return { scanned: r.scanned, updated: r.updated, seriesTouched: r.seriesTouched, mirrorChanged: r.mirrorChanged, seriesSkipped: r.seriesSkipped, tcgplayerFilled: r.tcgplayerFilled };
  } catch (err) {
    console.error("daily: MTG price refresh failed:", err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Lorcana, One Piece, Yu-Gi-Oh! prices + today's history point, one game at a time. Never throws. */
export async function runTcgStep(): Promise<NonNullable<DailyResult["tcg"]>> {
  const out: NonNullable<DailyResult["tcg"]> = {};
  for (const game of ["lorcana", "onepiece", "yugioh"] as const) {
    try {
      out[game] = await refreshTcgPrices(game);
    } catch (err) {
      console.error(`daily: ${game} price refresh failed:`, err);
      out[game] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}

/** Steps 2+3+5: Pokémon TCGCSV refresh, history sweep, eBay sales. Never throws. */
export async function runPokemonSteps(
  now = Date.now(),
): Promise<Pick<DailyResult, "pokemonTcgcsv" | "pokemon" | "ebaySales" | "ebayFees" | "wishlistAlerts" | "cardAlerts" | "weeklyDigest" | "autoOffers" | "billingReconcile">> {
  const result: Pick<DailyResult, "pokemonTcgcsv" | "pokemon" | "ebaySales" | "ebayFees" | "wishlistAlerts" | "cardAlerts" | "weeklyDigest" | "autoOffers" | "billingReconcile"> = {};
  // Money first: scans are credited by Stripe's invoice.paid webhook, and this
  // walk of the recently paid invoices credits any that never arrived (by
  // invoice id, so it can never double a credit). Capped at 20 s, never throws,
  // and runs before the slow steps that a killed run would skip.
  try {
    result.billingReconcile = await reconcilePaidInvoices();
  } catch (err) {
    result.billingReconcile = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: billing reconcile failed:", err);
  }
  try {
    if (await hasTcgplayerMap()) {
      // Sealed product map first (a few groups' product lists per run,
      // lib/server/sealedPrices.ts) so the refresh right after prices
      // whatever it found. Its failure never costs the card refresh.
      let sealedScan: { groupsScanned: number; groupsFailed: number; products: number } | { error: string };
      try {
        sealedScan = await scanSealedProducts();
      } catch (err) {
        sealedScan = { error: err instanceof Error ? err.message : String(err) };
        console.error("daily: sealed product scan failed:", err);
      }
      const r = await refreshPokemonPricesFromTcgcsv();
      result.pokemonTcgcsv = { groups: r.groups, groupsFailed: r.groupsFailed, seriesTouched: r.seriesTouched, sealedSeries: r.sealedSeries, sealedScan };
    } else {
      result.pokemonTcgcsv = { skipped: "no tcgplayer_products map — run npm run backfill:pokemon and redeploy the seed" };
    }
  } catch (err) {
    result.pokemonTcgcsv = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: Pokémon TCGCSV refresh failed:", err);
  }
  // Wishlist alerts go right after the bulk refresh (prices are fresh) and
  // BEFORE the slow steps: on 09-26 the run was killed at maxDuration inside
  // the held-card sweep and the dip email never went out.
  try {
    result.wishlistAlerts = await sweepWishlistAlerts(now);
  } catch (err) {
    result.wishlistAlerts = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: wishlist alert sweep failed:", err);
  }
  try {
    result.cardAlerts = await sweepCardAlerts(now);
  } catch (err) {
    result.cardAlerts = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: card alert sweep failed:", err);
  }
  // Sunday collection digest, same reasoning: mail before the slow steps.
  try {
    result.weeklyDigest = await sweepWeeklyDigest(now);
  } catch (err) {
    result.weeklyDigest = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: weekly digest failed:", err);
  }
  try {
    // Stop re-pricing held cards ~200s after the step started so the eBay
    // sync and the result write still fit inside the 300s function limit.
    const recorded = await sweepPriceHistory(now, now + 200_000);
    result.pokemon = { recorded };
  } catch (err) {
    result.pokemon = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: Pokémon sweep failed:", err);
  }
  try {
    const sellers = (await db
      .prepare(
        `SELECT DISTINCT user_id FROM cards
         WHERE status = 'listed' AND (ebay_listing_id IS NOT NULL OR ebay_sku IS NOT NULL)`,
      )
      .all()) as { user_id: string }[];
    let soldCount = 0;
    let endedCount = 0;
    for (const seller of sellers) {
      const r = await syncEbaySales(seller.user_id, true);
      soldCount += r.sold.length;
      // "Your card sold" on the phone (Tier 2 #9); never throws.
      if (r.sold.length > 0) await sendPushToUser(seller.user_id, soldPush(r.sold.map((c) => ({ name: c.cardName, soldPrice: c.soldPrice }))));
      // After sales, so a sold-out listing flips sold instead of "ended".
      const e = await syncEndedEbayListings(seller.user_id, true);
      endedCount += e.ended.length;
    }
    result.ebaySales = { sellers: sellers.length, sold: soldCount, endedListings: endedCount };
  } catch (err) {
    result.ebaySales = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: eBay sales sweep failed:", err);
  }
  try {
    // Own seller query — fee-pending sold rows outlive the listing that the
    // sales sweep keys on (a sold-out seller has no 'listed' cards left).
    const feeSellers = (await db
      .prepare(
        `SELECT DISTINCT user_id FROM cards
         WHERE status = 'sold' AND sold_fees IS NULL AND ebay_order_id IS NOT NULL`,
      )
      .all()) as { user_id: string }[];
    let feesFilled = 0;
    for (const seller of feeSellers) {
      const f = await syncEbayFees(seller.user_id, true);
      feesFilled += f.updated.length;
    }
    result.ebayFees = { sellers: feeSellers.length, filled: feesFilled };
  } catch (err) {
    result.ebayFees = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: eBay fee sweep failed:", err);
  }
  try {
    // Watcher offers for sellers who opted in on the collection page
    // (users.auto_offer_percent — strictly off by default). Runs after the
    // sales/ended sweeps so a listing that just sold or ended isn't offered.
    result.autoOffers = await sweepAutoOffers(now);
  } catch (err) {
    result.autoOffers = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: auto-offer sweep failed:", err);
  }
  return result;
}

/**
 * Merge a split cron run's partial result into the same meta keys the
 * all-in-one run writes, so the admin console shows one coherent "last
 * daily" picture whichever host ran it. `markFinished` only when the step
 * that must succeed daily (the MTG refresh) actually did.
 */
export async function recordCronResult(partial: Partial<DailyResult>, markFinished: boolean): Promise<void> {
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse((await metaGet(META.lastResult)) ?? "{}") as Record<string, unknown>;
  } catch {
    // Corrupt/absent — start fresh.
  }
  await metaSet(META.lastResult, JSON.stringify({ ...prev, ran: true, at: Date.now(), ...partial }));
  if (markFinished) await metaSet(META.finished, String(Date.now()));
}

/** Run if due; never throws (errors land in the result and the log). */
export async function runDailyIfDue(force = false, now = Date.now()): Promise<DailyResult> {
  if (!force && !(await dailyDue(now))) return { ran: false };
  if (running) return { ran: false };
  running = true;
  const t0 = Date.now();
  await metaSet(META.started, String(now));
  const result: DailyResult = { ran: true };
  try {
    result.mtg = await runMtgStep();
    result.tcg = await runTcgStep();
    Object.assign(result, await runPokemonSteps(now));
    result.logCleanup = await runLogCleanupIfDue(now); // weekly log retention; never throws
    result.ms = Date.now() - t0;
    // Only a run where Magic actually refreshed counts as "finished"; a
    // failed download leaves it due again on the next trigger.
    if (result.mtg && !("error" in result.mtg)) await metaSet(META.finished, String(Date.now()));
    await metaSet(META.lastResult, JSON.stringify({ at: Date.now(), ...result }));
    console.info("daily jobs:", JSON.stringify(result));
    return result;
  } finally {
    running = false;
  }
}
