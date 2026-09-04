import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ebayListingUrl } from "@/lib/ebayInventory";
import { EBAY_FEE_RATE, EBAY_FLAT_FEE } from "@/lib/fees";
import type { GameId } from "@/lib/types";

export type CardStatus = "ready" | "listed" | "sold";
/** "card" is a single (raw or slabbed); "sealed" is unopened product. */
export type CardKind = "card" | "sealed";

export interface CardRecord {
  id: string;
  userId: string;
  kind: CardKind;
  /** Which game the row is ("pokemon" | "mtg"). */
  game: GameId;
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  /** Sealed rows only: "Booster Box", "Elite Trainer Box", ... */
  productType: string | null;
  status: CardStatus;
  price: number;
  /** How many identical copies this row sells (listing quantity). */
  quantity: number;
  /** Catalog id (pokemontcg.io / Scryfall) — keys into price_series. */
  catalogCardId: string | null;
  listedAt: number | null;
  soldPrice: number | null;
  soldAt: number | null;
  /** Actual fee eBay charged for this sale (Finances API). Null = not fetched
   * yet — display falls back to the estimate in lib/fees.ts. */
  soldFees: number | null;
  /** eBay order/line the sold row came from, for the fee lookup. */
  ebayOrderId: string | null;
  ebayLineItemId: string | null;
  /** Last time a discount offer went to this listing's watchers. */
  watcherOfferAt: number | null;
  /**
   * When the seller confirmed the identified card is the one in hand
   * ("Verify match"). Publishing to eBay is refused while null — the gate
   * against blindly listing a wrong match (Chris, 09-03).
   */
  verifiedAt: number | null;
  /** Why the scan was doubtful ("low-confidence read", ...), null if clean. */
  matchDoubt: string | null;
  /** 1st Edition stamp (WotC-era Pokémon) — its own market and listing title. */
  firstEdition: boolean;
  /** Set once the draft has been pushed to the seller's eBay account. */
  ebayOfferId: string | null;
  /** Set once that offer was published — a live eBay item id. */
  ebayListingId: string | null;
  ebayListingUrl: string | null;
  ebayPushedAt: number | null;
  ebayPublishedAt: number | null;
  /** Set when the sweep found the live listing ended on eBay without a sale. */
  ebayEndedAt: number | null;
  /** When the seller's own photo of this copy was stored (see cardPhotos.ts). */
  photoAt: number | null;
  /** Listing API draft — visible in the seller's My eBay › Drafts. */
  ebayDraftId: string | null;
  ebayDraftUrl: string | null;
  ebayDraftAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface CardRow {
  id: string;
  user_id: string;
  kind: CardKind;
  game: GameId | null;
  card_name: string;
  set_name: string;
  card_number: string;
  image_url: string;
  condition: string;
  product_type: string | null;
  status: CardStatus;
  price: number;
  quantity: number | null;
  catalog_card_id: string | null;
  listed_at: number | null;
  sold_price: number | null;
  sold_at: number | null;
  sold_fees: number | null;
  ebay_order_id: string | null;
  ebay_line_item_id: string | null;
  watcher_offer_at: number | null;
  verified_at: number | null;
  match_doubt: string | null;
  first_edition: number | null;
  ebay_sku: string | null;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  ebay_pushed_at: number | null;
  ebay_published_at: number | null;
  ebay_ended_at: number | null;
  photo_at: number | null;
  ebay_draft_id: string | null;
  ebay_draft_url: string | null;
  ebay_draft_at: number | null;
  created_at: number;
  updated_at: number;
}

function fromRow(row: CardRow): CardRecord {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind ?? "card",
    game: row.game === "mtg" ? "mtg" : "pokemon",
    cardName: row.card_name,
    setName: row.set_name,
    cardNumber: row.card_number,
    imageUrl: row.image_url,
    condition: row.condition,
    productType: row.product_type ?? null,
    status: row.status,
    price: row.price,
    quantity: row.quantity ?? 1,
    catalogCardId: row.catalog_card_id ?? null,
    listedAt: row.listed_at,
    soldPrice: row.sold_price,
    soldAt: row.sold_at,
    soldFees: row.sold_fees ?? null,
    ebayOrderId: row.ebay_order_id ?? null,
    ebayLineItemId: row.ebay_line_item_id ?? null,
    watcherOfferAt: row.watcher_offer_at ?? null,
    verifiedAt: row.verified_at ?? null,
    matchDoubt: row.match_doubt ?? null,
    firstEdition: row.first_edition === 1,
    ebayOfferId: row.ebay_offer_id ?? null,
    ebayListingId: row.ebay_listing_id ?? null,
    ebayListingUrl: row.ebay_listing_id ? ebayListingUrl(row.ebay_listing_id) : null,
    ebayPushedAt: row.ebay_pushed_at ?? null,
    ebayPublishedAt: row.ebay_published_at ?? null,
    ebayEndedAt: row.ebay_ended_at ?? null,
    photoAt: row.photo_at ?? null,
    ebayDraftId: row.ebay_draft_id ?? null,
    ebayDraftUrl: row.ebay_draft_url ?? null,
    ebayDraftAt: row.ebay_draft_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewCard {
  kind?: CardKind;
  game?: GameId;
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  productType?: string | null;
  price: number;
  catalogCardId?: string | null;
}

export async function createCard(userId: string, card: NewCard): Promise<CardRecord> {
  const id = randomUUID();
  const now = Date.now();
  const kind: CardKind = card.kind === "sealed" ? "sealed" : "card";
  const productType = kind === "sealed" ? (card.productType ?? null) : null;
  const game: GameId = card.game === "mtg" ? "mtg" : "pokemon";

  await db
    .prepare(
      `INSERT INTO cards
         (id, user_id, kind, game, card_name, set_name, card_number, image_url, condition, product_type, status, price, catalog_card_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      kind,
      game,
      card.cardName,
      card.setName,
      card.cardNumber,
      card.imageUrl,
      card.condition,
      productType,
      card.price,
      card.catalogCardId ?? null,
      now,
      now,
    );

  return {
    id,
    userId,
    kind,
    game,
    cardName: card.cardName,
    setName: card.setName,
    cardNumber: card.cardNumber,
    imageUrl: card.imageUrl,
    condition: card.condition,
    productType,
    status: "ready",
    price: card.price,
    quantity: 1,
    catalogCardId: card.catalogCardId ?? null,
    listedAt: null,
    verifiedAt: null,
    matchDoubt: null,
    firstEdition: false,
    soldPrice: null,
    soldAt: null,
    soldFees: null,
    ebayOrderId: null,
    ebayLineItemId: null,
    watcherOfferAt: null,
    ebayOfferId: null,
    ebayListingId: null,
    ebayListingUrl: null,
    ebayPushedAt: null,
    ebayPublishedAt: null,
    ebayEndedAt: null,
    photoAt: null,
    ebayDraftId: null,
    ebayDraftUrl: null,
    ebayDraftAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getCardForUser(id: string, userId: string): Promise<CardRecord | null> {
  const row = (await db
    .prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?")
    .get(id, userId)) as CardRow | undefined;
  return row ? fromRow(row) : null;
}

/** Server-written after eBay returns a Listing API draft. */
export async function setCardEbayDraft(
  id: string,
  userId: string,
  draft: { draftId: string; draftUrl: string | null },
): Promise<CardRecord | null> {
  await db
    .prepare(
      "UPDATE cards SET ebay_draft_id = ?, ebay_draft_url = ?, ebay_draft_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .run(draft.draftId, draft.draftUrl, Date.now(), Date.now(), id, userId);
  return getCardForUser(id, userId);
}

/** Server-written when the seller's photo lands on disk (cardPhotos.ts). */
export async function setCardPhotoAt(id: string, userId: string, photoAt: number | null): Promise<void> {
  await db.prepare("UPDATE cards SET photo_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
    photoAt,
    Date.now(),
    id,
    userId,
  );
}

/** Whether a ledger row (any owner) has a stored photo — for the public photo route. */
export async function cardPhotoAt(id: string): Promise<number | null> {
  const row = (await db.prepare("SELECT photo_at FROM cards WHERE id = ?").get(id)) as
    | { photo_at: number | null }
    | undefined;
  return row?.photo_at ?? null;
}

export interface EbayListingState {
  sku: string;
  offerId: string;
  listingId?: string | null;
  pushedAt?: number | null;
  publishedAt?: number | null;
}

/**
 * Recorded by the server after each eBay call — never from a client PATCH, so
 * a listing id in the ledger always means eBay actually returned it. Passing
 * a field leaves it alone when undefined; publishing also flips the ledger to
 * "listed" at the offer's price so the two views agree.
 */
export async function setCardEbayListing(
  id: string,
  userId: string,
  state: EbayListingState,
): Promise<CardRecord | null> {
  const existing = await getCardForUser(id, userId);
  if (!existing) return null;
  const now = Date.now();
  const listingId = state.listingId !== undefined ? state.listingId : existing.ebayListingId;
  const publishedAt =
    state.publishedAt !== undefined ? state.publishedAt : existing.ebayPublishedAt;
  await db
    .prepare(
      `UPDATE cards
       SET ebay_sku = ?, ebay_offer_id = ?, ebay_listing_id = ?, ebay_pushed_at = ?, ebay_published_at = ?,
           ebay_ended_at = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      state.sku,
      state.offerId,
      listingId,
      state.pushedAt !== undefined ? state.pushedAt : existing.ebayPushedAt,
      publishedAt,
      now,
      id,
      userId,
    );
  return getCardForUser(id, userId);
}

/**
 * An eBay order bought `purchased` of this row's copies. When that clears the
 * row out, the row itself flips to sold (the familiar single-copy path).
 * A partial sale instead splits off a new sold row for the purchased copies —
 * so Earned stays honest — and decrements the listed row, which stays live
 * (eBay still has the rest available on the same offer).
 */
export async function recordCopiesSold(
  id: string,
  userId: string,
  purchased: number,
  soldPrice: number | null,
  soldAt: number,
  /** The eBay order/line behind this sale, so the fee sync can look up the
   * actual charge later. Absent for manual "Mark sold". */
  ebayRef?: { orderId: string | null; lineItemId: string | null },
): Promise<{ sold: CardRecord; remaining: CardRecord | null } | null> {
  const card = await getCardForUser(id, userId);
  if (!card) return null;
  const bought = Math.max(1, Math.floor(purchased));
  if (bought >= card.quantity) {
    const sold = await updateCard(id, userId, { status: "sold", soldPrice, soldAt });
    if (sold && ebayRef?.orderId) {
      await db
        .prepare("UPDATE cards SET ebay_order_id = ?, ebay_line_item_id = ? WHERE id = ? AND user_id = ?")
        .run(ebayRef.orderId, ebayRef.lineItemId, id, userId);
      sold.ebayOrderId = ebayRef.orderId;
      sold.ebayLineItemId = ebayRef.lineItemId;
    }
    return sold ? { sold, remaining: null } : null;
  }
  const soldId = randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO cards
         (id, user_id, kind, game, card_name, set_name, card_number, image_url, condition, product_type,
          status, price, quantity, catalog_card_id, listed_at, sold_price, sold_at, ebay_order_id, ebay_line_item_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sold', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      soldId,
      userId,
      card.kind,
      card.game,
      card.cardName,
      card.setName,
      card.cardNumber,
      card.imageUrl,
      card.condition,
      card.productType,
      card.price,
      bought,
      card.catalogCardId,
      card.listedAt,
      soldPrice,
      soldAt,
      ebayRef?.orderId ?? null,
      ebayRef?.lineItemId ?? null,
      now,
      now,
    );
  const remaining = await updateCard(id, userId, { quantity: card.quantity - bought });
  const sold = await getCardForUser(soldId, userId);
  return sold ? { sold, remaining } : null;
}

/** Server-written when a watcher offer goes out (ebayNegotiation.ts) only. */
export async function setWatcherOfferSent(id: string, userId: string, at: number): Promise<void> {
  await db
    .prepare("UPDATE cards SET watcher_offer_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(at, Date.now(), id, userId);
}

/** Server-written by the fee sync (ebayFinances.ts) only. */
export async function setCardSoldFees(id: string, userId: string, fees: number): Promise<void> {
  await db
    .prepare("UPDATE cards SET sold_fees = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(fees, Date.now(), id, userId);
}

/** Server-written by the ended-listing sweep (ebayListings.ts) only. */
export async function setCardListingEnded(id: string, userId: string, endedAt: number): Promise<CardRecord | null> {
  await db
    .prepare("UPDATE cards SET ebay_ended_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(endedAt, Date.now(), id, userId);
  return getCardForUser(id, userId);
}

export interface CardUpdate {
  condition?: string;
  price?: number;
  quantity?: number;
  status?: CardStatus;
  listedAt?: number | null;
  soldPrice?: number | null;
  soldAt?: number | null;
  verifiedAt?: number | null;
  matchDoubt?: string | null;
  firstEdition?: boolean;
}

/** Ownership is enforced here, not just at the route layer: the WHERE clause
 * requires a matching user_id, so one user can never mutate another's card
 * even if they guess a valid card id. */
export async function updateCard(
  id: string,
  userId: string,
  patch: CardUpdate,
): Promise<CardRecord | null> {
  const existingRow = (await db
    .prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?")
    .get(id, userId)) as CardRow | undefined;
  if (!existingRow) return null;

  const merged: CardRow = {
    ...existingRow,
    condition: patch.condition ?? existingRow.condition,
    price: patch.price ?? existingRow.price,
    quantity: patch.quantity ?? existingRow.quantity ?? 1,
    status: patch.status ?? existingRow.status,
    listed_at: patch.listedAt !== undefined ? patch.listedAt : existingRow.listed_at,
    sold_price: patch.soldPrice !== undefined ? patch.soldPrice : existingRow.sold_price,
    sold_at: patch.soldAt !== undefined ? patch.soldAt : existingRow.sold_at,
    verified_at: patch.verifiedAt !== undefined ? patch.verifiedAt : existingRow.verified_at,
    match_doubt: patch.matchDoubt !== undefined ? patch.matchDoubt : existingRow.match_doubt,
    first_edition: patch.firstEdition !== undefined ? (patch.firstEdition ? 1 : 0) : existingRow.first_edition,
    // Any status move settles the ended flag — sold/unlisted cards don't
    // need the chip, and a later manual "Mark listed" starts clean.
    ebay_ended_at: patch.status !== undefined ? null : existingRow.ebay_ended_at,
    // "Not sold after all": leaving sold drops the sale's fee record and its
    // eBay order link, or a later re-sale would wear the old sale's fees.
    ...(patch.status !== undefined && patch.status !== "sold" && existingRow.status === "sold"
      ? { sold_fees: null, ebay_order_id: null, ebay_line_item_id: null }
      : {}),
    updated_at: Date.now(),
  };

  await db
    .prepare(
      `UPDATE cards
       SET condition = ?, price = ?, quantity = ?, status = ?, listed_at = ?, sold_price = ?, sold_at = ?, verified_at = ?, match_doubt = ?, first_edition = ?, sold_fees = ?, ebay_order_id = ?, ebay_line_item_id = ?, ebay_ended_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      merged.condition,
      merged.price,
      merged.quantity ?? 1,
      merged.status,
      merged.listed_at,
      merged.sold_price,
      merged.sold_at,
      merged.verified_at ?? null,
      merged.match_doubt ?? null,
      merged.first_edition ?? null,
      merged.sold_fees,
      merged.ebay_order_id,
      merged.ebay_line_item_id,
      merged.ebay_ended_at,
      merged.updated_at,
      id,
      userId,
    );

  return fromRow(merged);
}

export async function deleteCard(id: string, userId: string): Promise<void> {
  await db.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").run(id, userId);
}

export async function listCardsForUser(userId: string): Promise<CardRecord[]> {
  const rows = (await db
    .prepare("SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId)) as unknown as CardRow[];
  return rows.map(fromRow);
}

export async function listAllCards(limit = 200): Promise<CardRecord[]> {
  const rows = (await db
    .prepare("SELECT * FROM cards ORDER BY created_at DESC LIMIT ?")
    .all(limit)) as unknown as CardRow[];
  return rows.map(fromRow);
}

export interface PlatformStats {
  totalUsers: number;
  connectedUsers: number;
  totalCards: number;
  readyCount: number;
  listedCount: number;
  soldCount: number;
  grossRevenue: number;
  estimatedFees: number;
  netRevenue: number;
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const totals = (await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) as totalUsers,
         (SELECT COUNT(*) FROM users WHERE ebay_connected = 1) as connectedUsers,
         (SELECT COUNT(*) FROM cards) as totalCards,
         (SELECT COUNT(*) FROM cards WHERE status = 'ready') as readyCount,
         (SELECT COUNT(*) FROM cards WHERE status = 'listed') as listedCount,
         (SELECT COUNT(*) FROM cards WHERE status = 'sold') as soldCount,
         (SELECT COALESCE(SUM(sold_price), 0) FROM cards WHERE status = 'sold') as grossRevenue,
         (SELECT COALESCE(SUM(sold_fees), 0) FROM cards WHERE status = 'sold' AND sold_fees IS NOT NULL) as actualFees,
         (SELECT COALESCE(SUM(sold_price), 0) FROM cards WHERE status = 'sold' AND sold_fees IS NULL) as unfetchedGross,
         (SELECT COUNT(*) FROM cards WHERE status = 'sold' AND sold_fees IS NULL AND sold_price IS NOT NULL) as unfetchedCount
      `,
    )
    .get()) as {
    totalUsers: number;
    connectedUsers: number;
    totalCards: number;
    readyCount: number;
    listedCount: number;
    soldCount: number;
    grossRevenue: number;
    actualFees: number;
    unfetchedGross: number;
    unfetchedCount: number;
  };

  // Actual Finances-API fees where recorded, the flat estimate for the rest.
  const { actualFees, unfetchedGross, unfetchedCount, ...rest } = totals;
  const estimatedFees =
    actualFees +
    (unfetchedGross > 0 ? unfetchedGross * EBAY_FEE_RATE + unfetchedCount * EBAY_FLAT_FEE : 0);

  return {
    ...rest,
    estimatedFees,
    netRevenue: totals.grossRevenue - estimatedFees,
  };
}
