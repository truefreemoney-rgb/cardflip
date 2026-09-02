import "server-only";
import { getUserAccessToken } from "@/lib/server/ebayAuth";
import { db } from "@/lib/db";
import { getCardForUser, setWatcherOfferSent, type CardRecord } from "@/lib/server/cards";
import { EbaySellError, ebayFetch } from "@/lib/server/ebaySell";

/**
 * Offers to watchers (Negotiation API). eBay decides which live listings are
 * "eligible" — ones with interested buyers (watchers/carters) who can be
 * messaged — and sendOfferToInterestedBuyers mails those buyers a discount
 * offer. Both calls run on the sell.inventory scope the app already holds
 * (eBay support, ticket 260901-000003: "sell.negotiation" is not a real
 * scope, and never was the requirement).
 *
 * IMPORTANT: sending is a REAL outward action — every send emails actual
 * buyers. The route only sends for the one card the seller clicked; the
 * daily sweep (sweepAutoOffers) sends only for sellers who explicitly
 * opted in, and each listing can only be offered to the same buyer once
 * per listing on eBay's side anyway.
 */

const OFFER_MESSAGE_MAX = 2000;

export interface EligibleResult {
  /** eBay listing ids that can receive a watcher offer right now. */
  listingIds: string[];
  skipped?: "not_connected" | "no_scope" | "error";
}

interface EligibleItem {
  listingId?: string;
}

/** eBay's listing-id universe for this seller's offer-eligible items. */
export async function findEligibleListingIds(userId: string): Promise<EligibleResult> {
  const token = await getUserAccessToken(userId);
  if (!token) return { listingIds: [], skipped: "not_connected" };

  const listingIds: string[] = [];
  try {
    // Paged: 200 per call, capped at 5 pages (1000 eligible listings) so a
    // huge seller can't stall a request loop on eBay round-trips.
    for (let offset = 0; offset < 1000; offset += 200) {
      const data = (await ebayFetch(
        token,
        "GET",
        `/sell/negotiation/v1/find_eligible_items?limit=200&offset=${offset}`,
      )) as { eligibleItems?: EligibleItem[]; next?: string } | null;
      const items = data?.eligibleItems ?? [];
      for (const item of items) {
        if (item.listingId) listingIds.push(item.listingId);
      }
      if (!data?.next || items.length < 200) break;
    }
  } catch (err) {
    if (err instanceof EbaySellError && err.status === 403) {
      return { listingIds: [], skipped: "no_scope" };
    }
    console.error("eBay find_eligible_items failed:", err);
    return { listingIds: [], skipped: "error" };
  }
  return { listingIds };
}

export interface SendOfferResult {
  ok: boolean;
  /** Seller-readable reason when not ok. */
  message?: string;
}

/**
 * Send one discount offer to everyone watching this card's live listing.
 * The caller has already verified ownership and that the card is listed.
 */
export async function sendWatcherOffer(
  userId: string,
  card: CardRecord,
  discountPercent: number,
  message?: string,
): Promise<SendOfferResult> {
  if (!card.ebayListingId) return { ok: false, message: "This card has no live eBay listing." };
  const percent = Math.round(discountPercent);
  // eBay accepts 5–80%; the UI caps tighter but the API is the backstop.
  if (!Number.isFinite(percent) || percent < 5 || percent > 50) {
    return { ok: false, message: "Discount must be between 5% and 50%." };
  }

  const token = await getUserAccessToken(userId);
  if (!token) return { ok: false, message: "Connect your eBay account first." };

  try {
    await ebayFetch(token, "POST", "/sell/negotiation/v1/send_offer_to_interested_buyers", {
      allowCounterOffer: false,
      ...(message?.trim() ? { message: message.trim().slice(0, OFFER_MESSAGE_MAX) } : {}),
      offeredItems: [
        {
          listingId: card.ebayListingId,
          quantity: String(card.quantity || 1),
          discountPercentage: String(percent),
        },
      ],
    });
  } catch (err) {
    if (err instanceof EbaySellError) {
      if (err.status === 403) {
        return { ok: false, message: "eBay declined — reconnect your eBay account and try again." };
      }
      // Common case: every interested buyer already got an offer on this
      // listing — eBay only allows one per buyer per listing.
      return { ok: false, message: err.sellerMessage };
    }
    console.error("eBay send offer failed:", err);
    return { ok: false, message: "Couldn't reach eBay — try again." };
  }

  await setWatcherOfferSent(card.id, userId, Date.now());
  return { ok: true };
}

/** A listing must be at least this old before the sweep will offer on it. */
export const AUTO_OFFER_MIN_LISTED_DAYS = 14;
/** Per-seller cap per daily run — a big stale collection trickles out, not blasts. */
const AUTO_OFFER_MAX_PER_RUN = 10;

export interface AutoOfferSweepResult {
  sellers: number;
  sent: number;
  failed: number;
}

/**
 * Daily-job sweep: for every seller who OPTED IN (users.auto_offer_percent
 * set), offer their slow movers to watchers — listed 14+ days, never offered
 * before, and on eBay's eligible list (i.e. it actually has interested
 * buyers). Strictly opt-in because every send emails real people; the
 * watcher_offer_at stamp plus eBay's own one-offer-per-buyer-per-listing
 * rule mean a listing is never spammed.
 */
export async function sweepAutoOffers(now = Date.now()): Promise<AutoOfferSweepResult> {
  const sellers = (await db
    .prepare(
      `SELECT id, auto_offer_percent, auto_offer_message FROM users
       WHERE auto_offer_percent IS NOT NULL`,
    )
    .all()) as { id: string; auto_offer_percent: number; auto_offer_message: string | null }[];

  const cutoff = now - AUTO_OFFER_MIN_LISTED_DAYS * 86_400_000;
  let sent = 0;
  let failed = 0;
  for (const seller of sellers) {
    const slow = (await db
      .prepare(
        `SELECT id, ebay_listing_id FROM cards
         WHERE user_id = ? AND status = 'listed' AND ebay_listing_id IS NOT NULL
           AND watcher_offer_at IS NULL AND listed_at IS NOT NULL AND listed_at <= ?`,
      )
      .all(seller.id, cutoff)) as { id: string; ebay_listing_id: string }[];
    if (slow.length === 0) continue;

    const eligible = await findEligibleListingIds(seller.id);
    if (eligible.skipped) continue; // not connected / no scope / eBay down — next run
    const eligibleSet = new Set(eligible.listingIds);

    let sentForSeller = 0;
    for (const row of slow) {
      if (sentForSeller >= AUTO_OFFER_MAX_PER_RUN) break;
      if (!eligibleSet.has(row.ebay_listing_id)) continue;
      const card = await getCardForUser(row.id, seller.id);
      if (!card) continue;
      const result = await sendWatcherOffer(
        seller.id,
        card,
        seller.auto_offer_percent,
        seller.auto_offer_message ?? undefined,
      );
      if (result.ok) {
        sent++;
        sentForSeller++;
      } else {
        failed++;
        console.warn(`auto-offer: send failed for card ${row.id}: ${result.message}`);
      }
    }
  }
  return { sellers: sellers.length, sent, failed };
}
