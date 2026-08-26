import "server-only";
import { db } from "@/lib/db";
import { cardPhotoAt, getCardForUser, setCardPhotoAt } from "@/lib/server/cards";

/**
 * The seller's own photo of each copy, stored as a blob in the `card_photos`
 * table — the same database that holds everything else (Turso in prod, the
 * local file in dev), so serverless hosting needs no separate file store
 * and no storage credentials.
 *
 * eBay's picture policy: a listing's photos must show the actual item being
 * sold — catalogue/stock art is not allowed for used items (every raw or
 * graded card is "used" to eBay), and the first real listing (08-16) went
 * live with an empty gallery on stock art anyway. So the photo the seller
 * scanned is stored here, keyed by ledger id, and `/api/card-image/[id]`
 * serves it to eBay's picture fetcher. Nothing else is ever sent as a
 * listing image.
 *
 * Files are JPEG already: the client downscales to ≤1600px and re-encodes
 * before upload (lib/client/cardPhotoApi.ts), which also turns HEIC into
 * something eBay ingests. The server still checks the magic bytes.
 */

/** Generous for a 1600px JPEG (~300–600KB); a hard stop against abuse. */
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

// Ledger ids are UUIDs; anything else never reaches a query.
const validId = (cardId: string) => /^[0-9a-f-]{36}$/i.test(cardId);

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export type StorePhotoResult =
  | { ok: true; photoAt: number }
  | { ok: false; reason: "not_found" | "not_jpeg" | "too_large" | "empty" };

/** Store the seller's photo for a card they own. Replaces any earlier one. */
export async function storeCardPhoto(cardId: string, userId: string, bytes: Buffer): Promise<StorePhotoResult> {
  if (!validId(cardId)) return { ok: false, reason: "not_found" };
  if (!(await getCardForUser(cardId, userId))) return { ok: false, reason: "not_found" };
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, reason: "too_large" };
  if (!isJpeg(bytes)) return { ok: false, reason: "not_jpeg" };
  const photoAt = Date.now();
  await db
    .prepare("INSERT OR REPLACE INTO card_photos (card_id, bytes, updated_at) VALUES (?, ?, ?)")
    .run(cardId, bytes, photoAt);
  await setCardPhotoAt(cardId, userId, photoAt);
  return { ok: true, photoAt };
}

/** Does this card (any owner) have a photo stored? */
export async function hasCardPhoto(cardId: string): Promise<boolean> {
  if (!validId(cardId)) return false;
  const row = await db.prepare("SELECT 1 AS one FROM card_photos WHERE card_id = ?").get(cardId);
  return Boolean(row);
}

/** The stored bytes, or null. Public read — it's the listing's own photo. */
export async function readCardPhoto(cardId: string): Promise<{ bytes: Buffer; photoAt: number } | null> {
  if (!validId(cardId)) return null;
  const row = (await db.prepare("SELECT bytes, updated_at FROM card_photos WHERE card_id = ?").get(cardId)) as
    | { bytes: ArrayBuffer | Uint8Array; updated_at: number }
    | undefined;
  if (!row) return null;
  // libsql hands blobs back as ArrayBuffer; normalise to Buffer either way.
  const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes as ArrayBuffer);
  return { bytes, photoAt: row.updated_at || ((await cardPhotoAt(cardId)) ?? 0) };
}

/** Remove the photo with its card (account deletion / card delete). */
export async function deleteCardPhoto(cardId: string): Promise<void> {
  if (!validId(cardId)) return;
  try {
    await db.prepare("DELETE FROM card_photos WHERE card_id = ?").run(cardId);
  } catch {
    // Nothing stored.
  }
}
