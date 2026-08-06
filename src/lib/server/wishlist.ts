import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { PokemonCard, ScanLanguage } from "@/lib/types";

export interface WishlistItem {
  id: string;
  userId: string;
  cardName: string;
  englishName: string | null;
  setName: string;
  cardNumber: string;
  language: ScanLanguage;
  imageUrl: string;
  price: number | null;
  addedAt: number;
}

interface WishlistRow {
  id: string;
  user_id: string;
  card_name: string;
  english_name: string | null;
  set_name: string;
  card_number: string;
  language: ScanLanguage;
  image_url: string;
  price: number | null;
  added_at: number;
}

function fromRow(row: WishlistRow): WishlistItem {
  return {
    id: row.id,
    userId: row.user_id,
    cardName: row.card_name,
    englishName: row.english_name,
    setName: row.set_name,
    cardNumber: row.card_number,
    language: row.language,
    imageUrl: row.image_url,
    price: row.price,
    addedAt: row.added_at,
  };
}

/** Silently no-ops on a duplicate (same user + card) rather than erroring —
 * clicking "add" on something already saved should just feel like it worked. */
export function addToWishlist(
  userId: string,
  card: PokemonCard,
  language: ScanLanguage,
  price: number | null,
): WishlistItem {
  const id = randomUUID();
  const addedAt = Date.now();

  db.prepare(
    `INSERT INTO wishlist_items
       (id, user_id, card_name, english_name, set_name, card_number, language, image_url, price, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, card_name, set_name, card_number) DO NOTHING`,
  ).run(
    id,
    userId,
    card.name,
    card.englishName,
    card.setName,
    card.number,
    language,
    card.imageSmall || card.imageLarge,
    price,
    addedAt,
  );

  const existing = db
    .prepare(
      "SELECT * FROM wishlist_items WHERE user_id = ? AND card_name = ? AND set_name = ? AND card_number = ?",
    )
    .get(userId, card.name, card.setName, card.number) as unknown as WishlistRow;

  return fromRow(existing);
}

export function removeFromWishlist(id: string, userId: string): void {
  db.prepare("DELETE FROM wishlist_items WHERE id = ? AND user_id = ?").run(id, userId);
}

export function listWishlist(userId: string): WishlistItem[] {
  const rows = db
    .prepare("SELECT * FROM wishlist_items WHERE user_id = ? ORDER BY added_at DESC")
    .all(userId) as unknown as WishlistRow[];
  return rows.map(fromRow);
}
