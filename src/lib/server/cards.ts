import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ebayListingUrl } from "@/lib/ebayInventory";
import { marketplaceByEbayId } from "@/lib/marketplaces";
import { EBAY_FEE_RATE, EBAY_FLAT_FEE, EBAY_FLAT_FEE_OVER_10 } from "@/lib/fees";
import type { GameId } from "@/lib/types";
import { parseGame } from "@/lib/games";

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
  /** Suggested price at scan time; null on rows from before it was stored (backfilled from history). */
  scanPrice: number | null;
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
  /** What the seller paid for it; null = not entered. Profit = sale − fees − postage − this. */
  costBasis: number | null;
  /** Owned-card price alert: mail when the asking price reaches this; null = off. alertedAt = sent. */
  alertPrice: number | null;
  alertedAt: number | null;
  /** eBay order/line the sold row came from, for the fee lookup. */
  ebayOrderId: string | null;
  ebayLineItemId: string | null;
  /** Last time a discount offer went to this listing's watchers. */
  watcherOfferAt: number | null;
  /** Seller set this price by hand — the live market refresh leaves it alone. */
  priceLocked: boolean;
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
  /** Price variant held as: Magic finish (foil / etched / nonfoil) or a Pokémon printing; null = default. */
  variant: string | null;
  /** Catalog rarity as the source spells it; null for rows scanned before it was stored. */
  rarity: string | null;
  /** Seller-chosen folder; null = uncategorized. */
  category: string | null;
  /**
   * The eBay site the offer/listing lives on (EBAY_GB, ...); null = EBAY_US, every listing that predates
   * per-country selling. Reprice, withdraw, the listing link and auto-offers use THIS, never the seller's
   * current home. listCurrency / listPriceLocal: what the asking price was sent in; listPriceLocal is the
   * authority for a local listing (price stays the USD equivalent for totals and charts).
   */
  ebayMarketplace: string | null;
  listCurrency: string | null;
  listPriceLocal: number | null;
  /** A sale in another currency: what the buyer paid, in soldCurrency (soldPrice is the USD equivalent at the sale date). */
  soldPriceLocal: number | null;
  soldCurrency: string | null;
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
  cost_basis: number | null;
  alert_price: number | null;
  alerted_at: number | null;
  spike_alerted_at: number | null;
  ebay_order_id: string | null;
  ebay_line_item_id: string | null;
  watcher_offer_at: number | null;
  price_locked: number | null;
  scan_price: number | null;
  verified_at: number | null;
  match_doubt: string | null;
  first_edition: number | null;
  variant: string | null;
  rarity: string | null;
  category: string | null;
  ebay_sku: string | null;
  ebay_marketplace: string | null;
  list_currency: string | null;
  list_price_local: number | null;
  sold_price_local: number | null;
  sold_currency: string | null;
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
    game: parseGame(row.game),
    cardName: row.card_name,
    setName: row.set_name,
    cardNumber: row.card_number,
    imageUrl: row.image_url,
    condition: row.condition,
    productType: row.product_type ?? null,
    status: row.status,
    price: row.price,
    scanPrice: row.scan_price ?? null,
    quantity: row.quantity ?? 1,
    catalogCardId: row.catalog_card_id ?? null,
    listedAt: row.listed_at,
    soldPrice: row.sold_price,
    soldAt: row.sold_at,
    soldFees: row.sold_fees ?? null,
    costBasis: row.cost_basis ?? null,
    alertPrice: row.alert_price ?? null,
    alertedAt: row.alerted_at ?? null,
    ebayOrderId: row.ebay_order_id ?? null,
    ebayLineItemId: row.ebay_line_item_id ?? null,
    watcherOfferAt: row.watcher_offer_at ?? null,
    priceLocked: row.price_locked === 1,
    verifiedAt: row.verified_at ?? null,
    matchDoubt: row.match_doubt ?? null,
    firstEdition: row.first_edition === 1,
    variant: row.variant ?? null,
    rarity: row.rarity ?? null,
    category: row.category ?? null,
    ebayMarketplace: row.ebay_marketplace ?? null,
    listCurrency: row.list_currency ?? null,
    listPriceLocal: row.list_price_local ?? null,
    soldPriceLocal: row.sold_price_local ?? null,
    soldCurrency: row.sold_currency ?? null,
    ebayOfferId: row.ebay_offer_id ?? null,
    ebayListingId: row.ebay_listing_id ?? null,
    ebayListingUrl: row.ebay_listing_id ? ebayListingUrl(row.ebay_listing_id, marketplaceByEbayId(row.ebay_marketplace)) : null,
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
  rarity?: string | null;
  category?: string | null;
  /** Set at creation when the seller's own app already named the card (CSV import). */
  verifiedAt?: number | null;
  /** Why the identification is doubtful; null = clean. */
  matchDoubt?: string | null;
  /** What the seller paid, when known at creation (CSV import). */
  costBasis?: number | null;
  /** 1st Edition printing (a "-1st" catalog twin). */
  firstEdition?: boolean;
  /** Variant the scan read (Magic finish) — the seller can change it in the editor. */
  variant?: string | null;
}

export async function createCard(userId: string, card: NewCard): Promise<CardRecord> {
  const id = randomUUID();
  const now = Date.now();
  const kind: CardKind = card.kind === "sealed" ? "sealed" : "card";
  const productType = kind === "sealed" ? (card.productType ?? null) : null;
  const game: GameId = parseGame(card.game);

  await db
    .prepare(
      `INSERT INTO cards
         (id, user_id, kind, game, card_name, set_name, card_number, image_url, condition, product_type, status, price, scan_price, catalog_card_id, rarity, category, verified_at, match_doubt, cost_basis, first_edition, variant, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      // A row created unpriced (sealed product before the feed's default
      // lands) leaves scan_price NULL so the live refresh backfills it from
      // the series on the add day instead of pinning "scanned at $0".
      card.price > 0 ? card.price : null,
      card.catalogCardId ?? null,
      card.rarity ?? null,
      card.category ?? null,
      card.verifiedAt ?? null,
      card.matchDoubt ?? null,
      card.costBasis ?? null,
      card.firstEdition ? 1 : 0,
      card.variant ?? null,
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
    scanPrice: card.price > 0 ? card.price : null,
    quantity: 1,
    catalogCardId: card.catalogCardId ?? null,
    listedAt: null,
    verifiedAt: card.verifiedAt ?? null,
    matchDoubt: card.matchDoubt ?? null,
    firstEdition: Boolean(card.firstEdition),
    variant: card.variant ?? null,
    rarity: card.rarity ?? null,
    category: card.category ?? null,
    soldPrice: null,
    soldAt: null,
    soldFees: null,
    costBasis: card.costBasis ?? null,
    alertPrice: null,
    alertedAt: null,
    ebayOrderId: null,
    ebayLineItemId: null,
    watcherOfferAt: null,
    priceLocked: false,
    ebayMarketplace: null,
    listCurrency: null,
    listPriceLocal: null,
    soldPriceLocal: null,
    soldCurrency: null,
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
  /**
   * The site the offer was created on, written in the SAME transaction as the
   * offer id so a failure between the two can never leave a GB offer recorded
   * as a US one. A value sets site / currency / local ask (and the USD ledger
   * price when priceUsd is given); null clears them back to eBay US; undefined
   * leaves them alone.
   */
  market?: { marketplace: string; currency: string; priceLocal: number; priceUsd?: number | null } | null;
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
  const params = [
    state.sku,
    state.offerId,
    listingId,
    state.pushedAt !== undefined ? state.pushedAt : existing.ebayPushedAt,
    publishedAt,
    now,
    id,
    userId,
  ];
  const offerSql = `UPDATE cards
       SET ebay_sku = ?, ebay_offer_id = ?, ebay_listing_id = ?, ebay_pushed_at = ?, ebay_published_at = ?,
           ebay_ended_at = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`;
  if (state.market === undefined) {
    await db.prepare(offerSql).run(...params);
  } else {
    await db.transaction(async (tx) => {
      await tx.prepare(offerSql).run(...params);
      if (state.market) {
        await tx
          .prepare(
            `UPDATE cards SET ebay_marketplace = ?, list_currency = ?, list_price_local = ?,
                    price = COALESCE(?, price) WHERE id = ? AND user_id = ?`,
          )
          .run(state.market.marketplace, state.market.currency, state.market.priceLocal, state.market.priceUsd ?? null, id, userId);
      } else {
        await tx
          .prepare("UPDATE cards SET ebay_marketplace = NULL, list_currency = NULL, list_price_local = NULL WHERE id = ? AND user_id = ?")
          .run(id, userId);
      }
    });
  }
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
  /** A sale in another currency: what the buyer paid (soldPrice is then the USD equivalent at the sale date). */
  soldLocal?: { price: number; currency: string } | null,
): Promise<{ sold: CardRecord; remaining: CardRecord | null } | null> {
  const card = await getCardForUser(id, userId);
  if (!card) return null;
  const bought = Math.max(1, Math.floor(purchased));
  if (bought >= card.quantity) {
    const sold = await updateCard(id, userId, { status: "sold", soldPrice, soldAt });
    if (sold && soldLocal) {
      await db
        .prepare("UPDATE cards SET sold_price_local = ?, sold_currency = ? WHERE id = ? AND user_id = ?")
        .run(soldLocal.price, soldLocal.currency, id, userId);
      sold.soldPriceLocal = soldLocal.price;
      sold.soldCurrency = soldLocal.currency;
    }
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
  // The split row and the decrement land together: a crash between them
  // would either double-count the copies (row inserted, listing untouched)
  // or lose the sale (listing decremented, no sold row).
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO cards
           (id, user_id, kind, game, card_name, set_name, card_number, image_url, condition, product_type,
            status, price, quantity, catalog_card_id, listed_at, sold_price, sold_at, ebay_order_id, ebay_line_item_id,
            sold_price_local, sold_currency, ebay_marketplace, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sold', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        soldLocal?.price ?? null,
        soldLocal?.currency ?? null,
        card.ebayMarketplace,
        now,
        now,
      );
    await tx
      .prepare("UPDATE cards SET quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(card.quantity - bought, now, id, userId);
  });
  const remaining = await getCardForUser(id, userId);
  const sold = await getCardForUser(soldId, userId);
  return sold ? { sold, remaining } : null;
}

/** Server-written when a watcher offer goes out (ebayNegotiation.ts) only. */
export async function setWatcherOfferSent(id: string, userId: string, at: number): Promise<void> {
  await db
    .prepare("UPDATE cards SET watcher_offer_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(at, Date.now(), id, userId);
}

/**
 * Server-written when a push/reprice sends a LOCAL-site price: the site, the
 * currency and the asking price in it (the authority for that listing), plus
 * the USD equivalent the ledger totals use. Never called for a US listing.
 */
export async function setCardListingMarket(
  id: string,
  userId: string,
  state: { marketplace: string; currency: string; priceLocal: number; priceUsd?: number | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE cards SET ebay_marketplace = ?, list_currency = ?, list_price_local = ?,
              price = COALESCE(?, price), updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(state.marketplace, state.currency, state.priceLocal, state.priceUsd ?? null, Date.now(), id, userId);
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
  /** The catalog card behind the row changed (candidate pick, printing swap). */
  cardName?: string;
  setName?: string;
  cardNumber?: string;
  imageUrl?: string;
  catalogCardId?: string | null;
  rarity?: string | null;
  category?: string | null;
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
  /** Variant / Magic finish the seller picked; null = back to the default. */
  variant?: string | null;
  /** True when the price in this patch was typed/chosen by the seller. */
  priceLocked?: boolean;
  costBasis?: number | null;
  /** Price alert target; null clears. Any change re-arms the alert. */
  alertPrice?: number | null;
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
    card_name: patch.cardName ?? existingRow.card_name,
    set_name: patch.setName ?? existingRow.set_name,
    card_number: patch.cardNumber ?? existingRow.card_number,
    image_url: patch.imageUrl ?? existingRow.image_url,
    catalog_card_id: patch.catalogCardId !== undefined ? patch.catalogCardId : existingRow.catalog_card_id,
    rarity: patch.rarity !== undefined ? patch.rarity : existingRow.rarity,
    category: patch.category !== undefined ? patch.category : existingRow.category,
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
    variant: patch.variant !== undefined ? patch.variant : existingRow.variant,
    price_locked: patch.priceLocked !== undefined ? (patch.priceLocked ? 1 : 0) : existingRow.price_locked,
    cost_basis: patch.costBasis !== undefined ? patch.costBasis : existingRow.cost_basis,
    alert_price: patch.alertPrice !== undefined ? patch.alertPrice : existingRow.alert_price,
    alerted_at: patch.alertPrice !== undefined && patch.alertPrice !== existingRow.alert_price ? null : existingRow.alerted_at,
    // Any status move settles the ended flag — sold/unlisted cards don't
    // need the chip, and a later manual "Mark listed" starts clean.
    ebay_ended_at: patch.status !== undefined ? null : existingRow.ebay_ended_at,
    // "Not sold after all": leaving sold drops the sale's fee record and its
    // eBay order link, or a later re-sale would wear the old sale's fees.
    ...(patch.status !== undefined && patch.status !== "sold" && existingRow.status === "sold"
      ? { sold_fees: null, ebay_order_id: null, ebay_line_item_id: null, sold_price_local: null, sold_currency: null }
      : {}),
    // A hand-corrected sale price is a USD figure: the foreign-currency record no longer describes it.
    ...(patch.soldPrice !== undefined && patch.soldPrice !== existingRow.sold_price
      ? { sold_price_local: null, sold_currency: null }
      : {}),
    updated_at: Date.now(),
  };

  await db
    .prepare(
      `UPDATE cards
       SET card_name = ?, set_name = ?, card_number = ?, image_url = ?, catalog_card_id = ?, rarity = ?, category = ?, condition = ?, price = ?, quantity = ?, status = ?, listed_at = ?, sold_price = ?, sold_at = ?, verified_at = ?, match_doubt = ?, first_edition = ?, variant = ?, price_locked = ?, cost_basis = ?, alert_price = ?, alerted_at = ?, sold_fees = ?, ebay_order_id = ?, ebay_line_item_id = ?, sold_price_local = ?, sold_currency = ?, ebay_ended_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      merged.card_name,
      merged.set_name,
      merged.card_number,
      merged.image_url,
      merged.catalog_card_id ?? null,
      merged.rarity ?? null,
      merged.category ?? null,
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
      merged.variant ?? null,
      merged.price_locked ?? 0,
      merged.cost_basis ?? null,
      merged.alert_price ?? null,
      merged.alerted_at ?? null,
      merged.sold_fees,
      merged.ebay_order_id,
      merged.ebay_line_item_id,
      merged.sold_price_local ?? null,
      merged.sold_currency ?? null,
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

/**
 * Bulk delete (09-09): the Inventory used to fire one DELETE per selected
 * card — 88 at once from one browser left every response lost on the way
 * back while the server had already removed the rows. One statement per
 * chunk instead. Sold rows are the record and are skipped, as is anything
 * that is not the seller's. Returns how many rows went.
 */
export async function deleteCards(ids: string[], userId: string): Promise<number> {
  const unique = [...new Set(ids)];
  let removed = 0;
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const marks = chunk.map(() => "?").join(", ");
    try {
      // Only the photos of rows this delete removes: the seller's own, unsold (10-01 sweep: it took any id it was sent,
      // another seller's photo included, and the photos of sold rows that stay as the record).
      await db
        .prepare(`DELETE FROM card_photos WHERE card_id IN (SELECT id FROM cards WHERE user_id = ? AND status != 'sold' AND id IN (${marks}))`)
        .run(userId, ...chunk);
    } catch {
      // Nothing stored.
    }
    const r = await db
      .prepare(`DELETE FROM cards WHERE user_id = ? AND status != 'sold' AND id IN (${marks})`)
      .run(userId, ...chunk);
    removed += Number(r.changes ?? 0);
  }
  return removed;
}

/** Folder management (09-08): categories are a text column, so a rename
 *  (or a merge into an existing name) is one UPDATE over the seller's rows.
 *  Returns how many cards moved. */
export async function renameCategory(userId: string, from: string, to: string): Promise<number> {
  const r = await db
    .prepare("UPDATE cards SET category = ?, updated_at = ? WHERE user_id = ? AND category = ?")
    .run(to, Date.now(), userId, from);
  await db.prepare("DELETE FROM categories WHERE user_id = ? AND name = ?").run(userId, from);
  await addCategory(userId, to);
  return Number(r.changes ?? 0);
}

/** A category with no cards yet (09-08). Idempotent. */
export async function addCategory(userId: string, name: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO categories (user_id, name, created_at) VALUES (?, ?, ?)")
    .run(userId, name, Date.now());
}

/** Every category the seller has: created on purpose, or carried by a card. A→Z. */
export async function listCategories(userId: string): Promise<string[]> {
  const rows = (await db
    .prepare(
      `SELECT name FROM categories WHERE user_id = ?
       UNION SELECT DISTINCT category AS name FROM cards WHERE user_id = ? AND category IS NOT NULL`,
    )
    .all(userId, userId)) as unknown as { name: string }[];
  const seen = new Map<string, string>();
  for (const r of rows) if (r.name && !seen.has(r.name.toLowerCase())) seen.set(r.name.toLowerCase(), r.name);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Delete a folder: its cards become uncategorized. Returns how many. */
export async function clearCategory(userId: string, from: string): Promise<number> {
  const r = await db
    .prepare("UPDATE cards SET category = NULL, updated_at = ? WHERE user_id = ? AND category = ?")
    .run(Date.now(), userId, from);
  await db.prepare("DELETE FROM categories WHERE user_id = ? AND name = ?").run(userId, from);
  return Number(r.changes ?? 0);
}

export async function listCardsForUser(userId: string): Promise<CardRecord[]> {
  const rows = (await db
    .prepare("SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId)) as unknown as CardRow[];
  return rows.map(fromRow);
}

/** Has this user scanned at least one card? Cheap existence check (idx_cards_user) for the header's logo link. */
export async function userHasCards(userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM cards WHERE user_id = ? LIMIT 1").get(userId);
  return Boolean(row);
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
         (SELECT COUNT(*) FROM cards WHERE status = 'sold' AND sold_fees IS NULL AND sold_price IS NOT NULL) as unfetchedCount,
         (SELECT COUNT(*) FROM cards WHERE status = 'sold' AND sold_fees IS NULL AND sold_price > 10) as unfetchedOver10
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
    unfetchedOver10: number;
  };

  // Actual Finances-API fees where recorded, the flat estimate for the rest.
  const { actualFees, unfetchedGross, unfetchedCount, unfetchedOver10, ...rest } = totals;
  const estimatedFees =
    actualFees +
    (unfetchedGross > 0 ? unfetchedGross * EBAY_FEE_RATE + unfetchedCount * EBAY_FLAT_FEE + unfetchedOver10 * (EBAY_FLAT_FEE_OVER_10 - EBAY_FLAT_FEE) : 0);

  return {
    ...rest,
    estimatedFees,
    netRevenue: totals.grossRevenue - estimatedFees,
  };
}
