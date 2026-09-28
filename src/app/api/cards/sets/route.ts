import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { missingInSet, setCompletion } from "@/lib/server/setCompletion";

/**
 * Set completion (09-27):
 *   GET /api/cards/sets            → every set the seller owns a card from, with the cheapest ten to finish
 *   GET /api/cards/sets?set=<id>   → the full missing list for one set
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const setId = req.nextUrl.searchParams.get("set");
    if (setId) return NextResponse.json({ missing: await missingInSet(user.id, setId.slice(0, 64)) });
    return NextResponse.json({ sets: await setCompletion(user.id) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
