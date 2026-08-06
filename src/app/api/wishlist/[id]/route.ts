import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { removeFromWishlist } from "@/lib/server/wishlist";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    const { id } = await params;
    removeFromWishlist(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
