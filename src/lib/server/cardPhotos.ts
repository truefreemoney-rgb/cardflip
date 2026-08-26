import "server-only";
import fs from "node:fs";
import path from "node:path";
import { cardPhotoAt, getCardForUser, setCardPhotoAt } from "@/lib/server/cards";
import { deleteObject, getObject, putObject, s3Configured } from "@/lib/server/backup";

/**
 * The seller's own photo of each copy.
 *
 * eBay's picture policy: a listing's photos must show the actual item being
 * sold — catalogue/stock art is not allowed for used items (every raw or
 * graded card is "used" to eBay), and the first real listing (08-16) went
 * live with an empty gallery on stock art anyway. So the photo the seller
 * scanned is stored here, keyed by ledger id, and `/api/card-image/[id]`
 * serves it to eBay's picture fetcher. Nothing else is ever sent as a
 * listing image.
 *
 * Storage backend: the Tigris S3 bucket (`photos/<id>.jpg`) when AWS_* /
 * BUCKET_NAME are set — serverless has no writable disk — otherwise the
 * local `data/photos/` directory for dev.
 *
 * Files are JPEG already: the client downscales to ≤1600px and re-encodes
 * before upload (lib/client/cardPhotoApi.ts), which also turns HEIC into
 * something eBay ingests. The server still checks the magic bytes.
 */
const PHOTO_DIR = path.join(process.cwd(), "data", "photos");
/** Generous for a 1600px JPEG (~300–600KB); a hard stop against abuse. */
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

const validId = (cardId: string) => /^[0-9a-f-]{36}$/i.test(cardId);

function photoPath(cardId: string): string {
  // Ledger ids are UUIDs; anything else never reaches the disk.
  if (!validId(cardId)) throw new Error("bad card id");
  return path.join(PHOTO_DIR, `${cardId}.jpg`);
}

function photoKey(cardId: string): string {
  if (!validId(cardId)) throw new Error("bad card id");
  return `photos/${cardId.toLowerCase()}.jpg`;
}

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export type StorePhotoResult =
  | { ok: true; photoAt: number }
  | { ok: false; reason: "not_found" | "not_jpeg" | "too_large" | "empty" };

/** Store the seller's photo for a card they own. Replaces any earlier one. */
export async function storeCardPhoto(cardId: string, userId: string, bytes: Buffer): Promise<StorePhotoResult> {
  if (!(await getCardForUser(cardId, userId))) return { ok: false, reason: "not_found" };
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, reason: "too_large" };
  if (!isJpeg(bytes)) return { ok: false, reason: "not_jpeg" };
  if (s3Configured()) {
    await putObject(photoKey(cardId), bytes, "image/jpeg");
  } else {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    const target = photoPath(cardId);
    // Write-then-rename so eBay never fetches a half-written file.
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, target);
  }
  const photoAt = Date.now();
  await setCardPhotoAt(cardId, userId, photoAt);
  return { ok: true, photoAt };
}

/**
 * Does this card (any owner) have a photo? The DB `photoAt` stamp is the
 * source of truth (it's only written after a successful store); on S3 we
 * trust it rather than paying a round-trip per check.
 */
export async function hasCardPhoto(cardId: string): Promise<boolean> {
  if (!validId(cardId)) return false;
  if (!(await cardPhotoAt(cardId))) return false;
  if (s3Configured()) return true;
  return fs.existsSync(photoPath(cardId));
}

/** The stored bytes, or null. Public read — it's the listing's own photo. */
export async function readCardPhoto(cardId: string): Promise<{ bytes: Buffer; photoAt: number } | null> {
  if (!(await hasCardPhoto(cardId))) return null;
  try {
    const bytes = s3Configured() ? await getObject(photoKey(cardId)) : fs.readFileSync(photoPath(cardId));
    if (!bytes) return null;
    return { bytes, photoAt: (await cardPhotoAt(cardId)) ?? 0 };
  } catch {
    return null;
  }
}

/** Remove the photo with its card (account deletion / card delete). */
export async function deleteCardPhoto(cardId: string): Promise<void> {
  try {
    if (s3Configured()) {
      await deleteObject(photoKey(cardId));
    } else {
      fs.unlinkSync(photoPath(cardId));
    }
  } catch {
    // Nothing stored.
  }
}
