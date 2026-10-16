import { NextResponse } from "next/server";
import { readCardPhoto } from "@/lib/server/cardPhotos";

/**
 * The listing photo eBay downloads when a card is pushed: the seller's own
 * photo of the copy (see lib/server/cardPhotos.ts), never catalogue art —
 * eBay's picture policy requires the actual item. eBay's picture service
 * fetches this URL itself from its own servers, so it is public and
 * unauthenticated; the id is the ledger UUID that also forms the SKU.
 */
export const dynamic = "force-dynamic";

/**
 * `?w=400` serves a small copy for the inventory tiles (10-16 audit: 40 full ~1150px scans, 270-490 KB each, for 164px
 * tiles). One allowed width, so the CDN holds one variant; eBay's fetch never sends `w` and keeps the full photo.
 */
const THUMB_WIDTH = 400;

async function thumbnail(bytes: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(bytes).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  } catch (err) {
    console.error("Card photo thumbnail failed, serving the full photo:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let photo: Awaited<ReturnType<typeof readCardPhoto>>;
  try {
    photo = await readCardPhoto(id);
  } catch (err) {
    // A disk/DB hiccup should read as a missing photo to eBay's fetcher, not
    // an opaque 500 that it may cache as a permanent failure.
    console.error("Card photo read failed:", id, err);
    return new NextResponse("Not found", { status: 404 });
  }
  if (!photo) return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  const small = url.searchParams.get("w") === String(THUMB_WIDTH) ? await thumbnail(photo.bytes) : null;
  const bytes = small ?? photo.bytes;
  // A thumbnail on a versioned URL (?v=photoAt changes with every new photo) never goes stale: cache it hard.
  const cache = small && url.searchParams.has("v") ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=3600";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Last-Modified": new Date(photo.photoAt || Date.now()).toUTCString(),
    },
  });
}
