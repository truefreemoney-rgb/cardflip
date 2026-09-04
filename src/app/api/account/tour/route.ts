import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { markTourSeen, toPublicUser } from "@/lib/server/users";

/**
 * The first-login tutorial was finished or skipped. Idempotent; the account
 * page's Replay never clears the flag (it re-runs the tour client-side).
 */
export async function POST() {
  try {
    const user = await requireUser();
    await markTourSeen(user.id);
    return NextResponse.json({ ok: true, user: toPublicUser({ ...user, tourSeenAt: Date.now() }) });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
