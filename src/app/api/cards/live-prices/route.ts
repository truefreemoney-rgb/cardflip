import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { apiFailure } from "@/lib/server/apiError";
import { refreshLivePrices } from "@/lib/server/livePrices";

/** Today's market for every Inventory row; unlocked drafts are repriced in place. */
export async function POST() {
  try {
    const user = await requireUser();
    return NextResponse.json({ prices: await refreshLivePrices(user.id) });
  } catch (err) {
    return apiFailure(err);
  }
}
