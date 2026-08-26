import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { MAX_PHOTO_BYTES, storeCardPhoto } from "@/lib/server/cardPhotos";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Store the seller's own photo of a ledger card — the only image eBay is
 * ever sent for it (picture policy: actual item, not stock art). Body is the
 * raw JPEG bytes (`Content-Type: image/jpeg`), already downscaled by the
 * client. Replaces any earlier photo; the SKU's inventory item picks up the
 * new file on the next push.
 */
export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Photo too large" }, { status: 413 });
    }
    const bytes = Buffer.from(await req.arrayBuffer());
    const result = await storeCardPhoto(id, user.id, bytes);
    if (!result.ok) {
      const status =
        result.reason === "not_found" ? 404 : result.reason === "too_large" ? 413 : 400;
      const message =
        result.reason === "not_found"
          ? "Card not found"
          : result.reason === "too_large"
            ? "Photo too large"
            : "Photo must be a JPEG";
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ ok: true, photoAt: result.photoAt });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
