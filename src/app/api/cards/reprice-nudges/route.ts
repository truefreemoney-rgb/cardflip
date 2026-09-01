import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { getRepriceNudges } from "@/lib/server/repriceNudges";

/** Listed cards whose asking price the market has left behind (±15%, 7d+). */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ nudges: await getRepriceNudges(user.id) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
