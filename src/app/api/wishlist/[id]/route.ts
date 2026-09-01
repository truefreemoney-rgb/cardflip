import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { removeFromWishlist, setWishlistAlert } from "@/lib/server/wishlist";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Set or clear the price-dip alert: { alertPrice: number | null }. */
export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { alertPrice?: unknown } | null;
    const raw = body?.alertPrice;
    const alertPrice =
      raw === null ? null : typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : undefined;
    if (alertPrice === undefined) {
      return NextResponse.json({ error: "alertPrice must be a positive number or null" }, { status: 400 });
    }
    const item = await setWishlistAlert(id, user.id, alertPrice);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await removeFromWishlist(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
