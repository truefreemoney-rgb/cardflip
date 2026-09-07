import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { refreshLivePrices } from "@/lib/server/livePrices";

/** Today's market for every Inventory row; unlocked drafts are repriced in place. */
export async function POST() {
  try {
    const user = await requireUser();
    return NextResponse.json({ prices: await refreshLivePrices(user.id) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
