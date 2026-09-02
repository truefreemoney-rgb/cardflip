import { db } from "@/lib/db";
import { backupConfigured, runNightlyBackup } from "@/lib/server/backup";
import { syncEbaySales } from "@/lib/server/ebayOrders";
import { syncEndedEbayListings } from "@/lib/server/ebayListings";
import { syncEbayFees } from "@/lib/server/ebayFinances";
import { sweepWishlistAlerts } from "@/lib/server/wishlistAlerts";
import { sweepAutoOffers } from "@/lib/server/ebayNegotiation";
import { refreshMtgPricesFromBulk } from "@/lib/server/mtgPriceRefresh";
import { sweepPriceHistory } from "@/lib/server/priceHistory";
import { hasTcgplayerMap, refreshPokemonPricesFromTcgcsv } from "@/lib/server/pokemonPriceRefresh";

/**
 * The once-a-day maintenance run that keeps the charts moving:
 *   1. Magic prices from Scryfall's bulk file (mirror + history point)
 *   2. Pokémon points for every mapped card from TCGCSV (TCGplayer daily)
 *   3. Pokémon sweep of held / recently looked-up cards via pokemontcg.io
 *      (adds Cardmarket EUR and covers cards TCGCSV doesn't map)
 *   4. SQLite backup to the Tigris bucket (lib/server/backup.ts)
 *   5. eBay sales sweep for every seller with live listings, so sold cards
 *      flip even when the seller doesn't open the app (lib/server/ebayOrders.ts)
 *
 * Triggered from three places, all funnelled through `runDailyIfDue` so it
 * can never double-run:
 *   - an hourly timer while the machine is awake (instrumentation.ts)
 *   - the /api/auth/me heartbeat (any app page load, via after())
 *   - GET /api/cron/daily?key=CRON_SECRET for an external pinger, which is
 *     what covers a zero-traffic day on a scale-to-zero machine.
 * "Due" = last successful finish > 20h ago, or a run that started > 45 min
 * ago and never finished (the machine was suspended mid-way — resume).
 */

const META = {
  started: "daily_started_at",
  finished: "daily_finished_at",
  lastResult: "daily_last_result",
};
const DUE_AFTER_MS = 20 * 60 * 60 * 1000;
const STALE_START_MS = 45 * 60 * 1000;
let running = false;

async function metaGet(key: string): Promise<string | null> {
  const row = (await db.prepare("SELECT value FROM price_history_meta WHERE key = ?").get(key)) as { value: string } | undefined;
  return row?.value ?? null;
}
async function metaSet(key: string, value: string): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)").run(key, value);
}

export async function dailyDue(now = Date.now()): Promise<boolean> {
  if (running) return false;
  const finished = Number((await metaGet(META.finished)) ?? 0);
  const started = Number((await metaGet(META.started)) ?? 0);
  if (now - finished > DUE_AFTER_MS && now - started > STALE_START_MS) return true;
  return false;
}

export async function dailyStatus() {
  return {
    running,
    startedAt: Number((await metaGet(META.started)) ?? 0) || null,
    finishedAt: Number((await metaGet(META.finished)) ?? 0) || null,
    lastResult: await metaGet(META.lastResult),
  };
}

export interface DailyResult {
  ran: boolean;
  mtg?: { scanned: number; updated: number; seriesTouched: number } | { error: string };
  pokemonTcgcsv?: { groups: number; groupsFailed: number; seriesTouched: number } | { error: string } | { skipped: string };
  pokemon?: { recorded: number } | { error: string };
  backup?: { key: string; bytes: number } | { error: string } | { skipped: string };
  ebaySales?: { sellers: number; sold: number; endedListings: number } | { error: string };
  ebayFees?: { sellers: number; filled: number } | { error: string };
  wishlistAlerts?: { checked: number; sent: number } | { error: string };
  autoOffers?: { sellers: number; sent: number; failed: number } | { error: string };
  ms?: number;
}

/** Step 1 alone: Magic prices from Scryfall's bulk file. Never throws. */
export async function runMtgStep(): Promise<NonNullable<DailyResult["mtg"]>> {
  try {
    const r = await refreshMtgPricesFromBulk();
    return { scanned: r.scanned, updated: r.updated, seriesTouched: r.seriesTouched };
  } catch (err) {
    console.error("daily: MTG price refresh failed:", err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Steps 2+3+5: Pokémon TCGCSV refresh, history sweep, eBay sales. Never throws. */
export async function runPokemonSteps(
  now = Date.now(),
): Promise<Pick<DailyResult, "pokemonTcgcsv" | "pokemon" | "ebaySales" | "ebayFees" | "wishlistAlerts" | "autoOffers">> {
  const result: Pick<DailyResult, "pokemonTcgcsv" | "pokemon" | "ebaySales" | "ebayFees" | "wishlistAlerts" | "autoOffers"> = {};
  try {
    if (await hasTcgplayerMap()) {
      const r = await refreshPokemonPricesFromTcgcsv();
      result.pokemonTcgcsv = { groups: r.groups, groupsFailed: r.groupsFailed, seriesTouched: r.seriesTouched };
    } else {
      result.pokemonTcgcsv = { skipped: "no tcgplayer_products map — run npm run backfill:pokemon and redeploy the seed" };
    }
  } catch (err) {
    result.pokemonTcgcsv = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: Pokémon TCGCSV refresh failed:", err);
  }
  try {
    const recorded = await sweepPriceHistory(now);
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
    // After the price refreshes above, so alerts judge today's numbers.
    result.wishlistAlerts = await sweepWishlistAlerts(now);
  } catch (err) {
    result.wishlistAlerts = { error: err instanceof Error ? err.message : String(err) };
    console.error("daily: wishlist alert sweep failed:", err);
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
    Object.assign(result, await runPokemonSteps(now));
    try {
      if (backupConfigured()) {
        const r = await runNightlyBackup();
        result.backup = { key: r.key, bytes: r.bytes };
      } else {
        result.backup = { skipped: "AWS_*/BUCKET_NAME not set — flyctl storage create" };
      }
    } catch (err) {
      result.backup = { error: err instanceof Error ? err.message : String(err) };
      console.error("daily: backup failed:", err);
    }
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
