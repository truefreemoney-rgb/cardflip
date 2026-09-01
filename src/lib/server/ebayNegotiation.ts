import "server-only";
import { getUserAccessToken } from "@/lib/server/ebayAuth";
import { setWatcherOfferSent, type CardRecord } from "@/lib/server/cards";
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
 * buyers. Nothing in this module fires on its own; the route only sends for
 * the one card the seller clicked, and each listing can only be offered to
 * the same buyer once per listing on eBay's side anyway.
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
    // One page of 200 covers any realistic CardFlip seller today; `next`
    // pagination can come back when someone runs thousands of listings.
    const data = (await ebayFetch(
      token,
      "GET",
      "/sell/negotiation/v1/find_eligible_items?limit=200",
    )) as { eligibleItems?: EligibleItem[] } | null;
    for (const item of data?.eligibleItems ?? []) {
      if (item.listingId) listingIds.push(item.listingId);
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
