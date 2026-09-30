import { NextResponse } from "next/server";
import { requireAdminOwner, AuthError } from "@/lib/server/auth";
import { markEmailConfirmed } from "@/lib/server/emailVerify";
import { findUserById, toPublicUser } from "@/lib/server/users";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Admin: mark an account's email confirmed by hand (Mark Confirmed, for a
 * support ticket where the code never arrived). Owner-trusted, so the
 * account is stamped as proven; no welcome mail goes out, since the address
 * may be exactly what was wrong. The free trial is settled the same way as
 * for a code (a repeat signup on the same device or IP stays at zero).
 * 200 { changed, user }; changed is false if the account was not waiting.
 */
export async function PATCH(_req: Request, { params }: RouteParams) {
  try {
    await requireAdminOwner();
    const { id } = await params;
    if (!(await findUserById(id))) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const { changed } = await markEmailConfirmed(id, { verified: true });
    const user = await findUserById(id);
    return NextResponse.json({ changed, user: user ? toPublicUser(user) : null });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("mark email confirmed failed:", err);
    return NextResponse.json({ error: "Couldn't mark the email confirmed" }, { status: 500 });
  }
}
