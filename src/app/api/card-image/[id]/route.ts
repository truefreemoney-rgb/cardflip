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

export async function GET(
  _req: Request,
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
  return new NextResponse(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Last-Modified": new Date(photo.photoAt || Date.now()).toUTCString(),
    },
  });
}
