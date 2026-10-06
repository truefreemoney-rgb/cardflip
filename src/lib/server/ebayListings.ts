import "server-only";
import { db } from "@/lib/db";
import { tokenOrSkip } from "@/lib/server/ebayAuth";
import { setCardListingEnded, type CardRecord } from "@/lib/server/cards";
import { EbaySellError, ebayFetch } from "@/lib/server/ebaySell";
import { marketplaceByEbayId } from "@/lib/marketplaces";

/**
 * The other half of closing the loop after "publish": a listing that ends on
 * eBay WITHOUT selling (seller ended it there, eBay pulled it, GTC lapsed)
 * left the card sitting as "listed" here forever — the sales sweep only sees
 * orders. This asks the Inventory API about each published offer and stamps
 * `ebay_ended_at` when the listing is gone, so the ledger can show an
 * "Ended on eBay" chip and let the seller decide (relist, or back to drafts)
 * instead of silently flipping their card around.
 *
 * Only cards with ebay_listing_id are checked — an offer that was pushed but
 * never published is legitimately UNPUBLISHED and must not be flagged.
 * Runs after syncEbaySales in both callers, so a card that ended because it
 * SOLD has already flipped to "sold" and never reaches this query.
 */

// One minute (10-03: Chris ended a card on eBay at 12:29, opened Inventory at 12:31 and it still read
// 'listed' because the last ask was at 12:23 under the old ten-minute gap). One GET per live listing,
// at most MAX_CHECKS_PER_PASS, so a minute is cheap against eBay's daily call cap.
const THROTTLE_MS = 60 * 1000;
const MAX_CHECKS_PER_PASS = 25;
// After a failed pass, wait this long (not the full throttle) before asking eBay again.
const FAIL_BACKOFF_MS = 5 * 60 * 1000;

export interface EndedSyncResult {
  /** Cards stamped ended-on-eBay in this pass. */
  ended: CardRecord[];
  skipped?: "not_connected" | "no_listings" | "throttled" | "error";
}

interface EbayOffer {
  status?: string;
  listing?: { listingStatus?: string };
}

function metaKey(userId: string): string {
  return `ebay_ended_sync:${userId}`;
}
async function lastSyncAt(userId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT value FROM price_history_meta WHERE key = ?")
    .get(metaKey(userId))) as { value: string } | undefined;
  return Number(row?.value ?? 0);
}
async function recordSyncAt(userId: string, at: number): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)").run(
    metaKey(userId),
    String(at),
  );
}

async function checkedTimes(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length <= MAX_CHECKS_PER_PASS) return out; // everything fits in one pass: no rotation needed
  const rows = (await db
    .prepare("SELECT key, value FROM price_history_meta WHERE key LIKE 'ebay_ended_check:%'")
    .all()) as { key: string; value: string }[];
  const want = new Set(ids);
  for (const r of rows) {
    const id = r.key.slice("ebay_ended_check:".length);
    if (want.has(id)) out.set(id, Number(r.value) || 0);
  }
  return out;
}

/** Is this offer's listing no longer live, per eBay? */
function listingEnded(offer: EbayOffer): boolean {
  // getOffer's listing.listingStatus is the authority: ACTIVE means live,
  // OUT_OF_STOCK is a sale the order sweep will settle — leave it alone.
  const status = offer.listing?.listingStatus?.toUpperCase();
  if (status === "ACTIVE" || status === "OUT_OF_STOCK") return false;
  if (status === "ENDED" || status === "INACTIVE") return true;
  // No listing block at all on a card we know was published = ended + purged.
  return offer.status?.toUpperCase() === "UNPUBLISHED";
}

export async function syncEndedEbayListings(userId: string, force = false): Promise<EndedSyncResult> {
  const listed = (await db
    .prepare(
      `SELECT id, ebay_offer_id, ebay_marketplace FROM cards
       WHERE user_id = ? AND status = 'listed'
         AND ebay_offer_id IS NOT NULL AND ebay_listing_id IS NOT NULL
         AND ebay_ended_at IS NULL`,
    )
    .all(userId)) as { id: string; ebay_offer_id: string; ebay_marketplace: string | null }[];
  if (listed.length === 0) return { ended: [], skipped: "no_listings" };

  const now = Date.now();
  if (!force && now - (await lastSyncAt(userId)) < THROTTLE_MS) return { ended: [], skipped: "throttled" };

  const token = await tokenOrSkip(userId);
  if (token === "not_connected") return { ended: [], skipped: token };
  if (token === "error") {
    await recordSyncAt(userId, now - THROTTLE_MS + FAIL_BACKOFF_MS).catch(() => {});
    return { ended: [], skipped: token };
  }

  // Rotate: oldest-checked first, so a ledger over MAX_CHECKS_PER_PASS gets every listing looked at in turn.
  const checkedAt = await checkedTimes(listed.map((c) => c.id));
  listed.sort((a, b) => (checkedAt.get(a.id) ?? 0) - (checkedAt.get(b.id) ?? 0));
  const ended: CardRecord[] = [];
  try {
    // One GET per live listing; bounded so a huge ledger can't stall a page
    // load — the daily sweep and later passes pick up the rest.
    for (const card of listed.slice(0, MAX_CHECKS_PER_PASS)) {
      let offer: EbayOffer | null = null;
      try {
        offer = (await ebayFetch(
          token,
          "GET",
          `/sell/inventory/v1/offer/${encodeURIComponent(card.ebay_offer_id)}`,
          undefined,
          undefined,
          marketplaceByEbayId(card.ebay_marketplace),
        )) as EbayOffer | null;
      } catch (err) {
        // The offer being gone entirely is eBay's strongest "ended" signal.
        if (err instanceof EbaySellError && err.status === 404) {
          offer = null;
        } else {
          throw err;
        }
      }
      await db
        .prepare("INSERT OR REPLACE INTO price_history_meta (key, value) VALUES (?, ?)")
        .run(`ebay_ended_check:${card.id}`, String(now));
      if (offer === null || listingEnded(offer)) {
        const updated = await setCardListingEnded(card.id, userId, now);
        if (updated) ended.push(updated);
      }
    }
  } catch (err) {
    console.error("eBay ended-listing sync failed:", err);
    await recordSyncAt(userId, now - THROTTLE_MS + FAIL_BACKOFF_MS).catch(() => {});
    return { ended, skipped: "error" };
  }

  await recordSyncAt(userId, now);
  return { ended };
}
