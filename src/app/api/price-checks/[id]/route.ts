import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { deletePriceCheck } from "@/lib/server/priceChecks";

/** Remove one lookup from the history. Ownership enforced in the query. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await deletePriceCheck(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
