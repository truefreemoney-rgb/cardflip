import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AuthError, SESSION_COOKIE, requireUser } from "@/lib/server/auth";
import { verifyPassword } from "@/lib/server/password";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { isDemoUser, updateUserPassword } from "@/lib/server/users";
import { destroyOtherSessions } from "@/lib/server/sessions";

/**
 * Change password while signed in. Requires the current password (a stolen
 * phone shouldn't be able to lock the owner out), enforces the same minimum
 * as signup, and signs out every *other* device — the session doing the
 * change keeps working.
 */
export async function POST(req: NextRequest) {
  const limited = limitOrRespond(`account:password:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account has no password to change" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
    }
    if (newPassword === currentPassword) {
      return NextResponse.json({ error: "New password matches the current one" }, { status: 400 });
    }

    await updateUserPassword(user.id, newPassword);
    const store = await cookies();
    const signedOut = await destroyOtherSessions(user.id, store.get(SESSION_COOKIE)?.value ?? null);
    return NextResponse.json({ ok: true, signedOutElsewhere: signedOut });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
