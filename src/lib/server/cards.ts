import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ebayListingUrl } from "@/lib/ebayInventory";
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
  listedAt: number | null;
  soldPrice: number | null;
  soldAt: number | null;
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
  listed_at: number | null;
  sold_price: number | null;
  sold_at: number | null;
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
    listedAt: row.listed_at,
    soldPrice: row.sold_price,
    soldAt: row.sold_at,
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
         (id, user_id, kind, game, card_name, set_name, card_number, image_url, condition, product_type, status, price, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
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
    listedAt: null,
    soldPrice: null,
    soldAt: null,
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
  status?: CardStatus;
  listedAt?: number | null;
  soldPrice?: number | null;
  soldAt?: number | null;
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
    status: patch.status ?? existingRow.status,
    listed_at: patch.listedAt !== undefined ? patch.listedAt : existingRow.listed_at,
    sold_price: patch.soldPrice !== undefined ? patch.soldPrice : existingRow.sold_price,
    sold_at: patch.soldAt !== undefined ? patch.soldAt : existingRow.sold_at,
    // Any status move settles the ended flag — sold/unlisted cards don't
    // need the chip, and a later manual "Mark listed" starts clean.
    ebay_ended_at: patch.status !== undefined ? null : existingRow.ebay_ended_at,
    updated_at: Date.now(),
  };

  await db
    .prepare(
      `UPDATE cards
       SET condition = ?, price = ?, status = ?, listed_at = ?, sold_price = ?, sold_at = ?, ebay_ended_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      merged.condition,
      merged.price,
      merged.status,
      merged.listed_at,
      merged.sold_price,
      merged.sold_at,
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

const EBAY_FEE_RATE = 0.1325;
const EBAY_FLAT_FEE = 0.3;

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
         (SELECT COALESCE(SUM(sold_price), 0) FROM cards WHERE status = 'sold') as grossRevenue
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
  };

  const estimatedFees =
    totals.grossRevenue > 0
      ? totals.grossRevenue * EBAY_FEE_RATE + totals.soldCount * EBAY_FLAT_FEE
      : 0;

  return {
    ...totals,
    estimatedFees,
    netRevenue: totals.grossRevenue - estimatedFees,
  };
}
