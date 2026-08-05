import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

export type CardStatus = "ready" | "listed" | "sold";

export interface CardRecord {
  id: string;
  userId: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  status: CardStatus;
  price: number;
  listedAt: number | null;
  soldPrice: number | null;
  soldAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface CardRow {
  id: string;
  user_id: string;
  card_name: string;
  set_name: string;
  card_number: string;
  image_url: string;
  condition: string;
  status: CardStatus;
  price: number;
  listed_at: number | null;
  sold_price: number | null;
  sold_at: number | null;
  created_at: number;
  updated_at: number;
}

function fromRow(row: CardRow): CardRecord {
  return {
    id: row.id,
    userId: row.user_id,
    cardName: row.card_name,
    setName: row.set_name,
    cardNumber: row.card_number,
    imageUrl: row.image_url,
    condition: row.condition,
    status: row.status,
    price: row.price,
    listedAt: row.listed_at,
    soldPrice: row.sold_price,
    soldAt: row.sold_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewCard {
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  price: number;
}

export function createCard(userId: string, card: NewCard): CardRecord {
  const id = randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO cards
       (id, user_id, card_name, set_name, card_number, image_url, condition, status, price, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
  ).run(
    id,
    userId,
    card.cardName,
    card.setName,
    card.cardNumber,
    card.imageUrl,
    card.condition,
    card.price,
    now,
    now,
  );

  return {
    id,
    userId,
    cardName: card.cardName,
    setName: card.setName,
    cardNumber: card.cardNumber,
    imageUrl: card.imageUrl,
    condition: card.condition,
    status: "ready",
    price: card.price,
    listedAt: null,
    soldPrice: null,
    soldAt: null,
    createdAt: now,
    updatedAt: now,
  };
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
export function updateCard(
  id: string,
  userId: string,
  patch: CardUpdate,
): CardRecord | null {
  const existingRow = db
    .prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?")
    .get(id, userId) as CardRow | undefined;
  if (!existingRow) return null;

  const merged: CardRow = {
    ...existingRow,
    condition: patch.condition ?? existingRow.condition,
    price: patch.price ?? existingRow.price,
    status: patch.status ?? existingRow.status,
    listed_at: patch.listedAt !== undefined ? patch.listedAt : existingRow.listed_at,
    sold_price: patch.soldPrice !== undefined ? patch.soldPrice : existingRow.sold_price,
    sold_at: patch.soldAt !== undefined ? patch.soldAt : existingRow.sold_at,
    updated_at: Date.now(),
  };

  db.prepare(
    `UPDATE cards
     SET condition = ?, price = ?, status = ?, listed_at = ?, sold_price = ?, sold_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    merged.condition,
    merged.price,
    merged.status,
    merged.listed_at,
    merged.sold_price,
    merged.sold_at,
    merged.updated_at,
    id,
    userId,
  );

  return fromRow(merged);
}

export function deleteCard(id: string, userId: string): void {
  db.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").run(id, userId);
}

export function listCardsForUser(userId: string): CardRecord[] {
  const rows = db
    .prepare("SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as unknown as CardRow[];
  return rows.map(fromRow);
}

export function listAllCards(limit = 200): CardRecord[] {
  const rows = db
    .prepare("SELECT * FROM cards ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as CardRow[];
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

export function getPlatformStats(): PlatformStats {
  const totals = db
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
    .get() as {
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
