import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AuthError, SESSION_COOKIE, requireUser } from "@/lib/server/auth";
import { destroyOtherSessions } from "@/lib/server/sessions";

/** "Sign out everywhere else" — every device but this one. */
export async function DELETE() {
  try {
    const user = await requireUser();
    const store = await cookies();
    const signedOut = destroyOtherSessions(user.id, store.get(SESSION_COOKIE)?.value ?? null);
    return NextResponse.json({ ok: true, signedOut });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
