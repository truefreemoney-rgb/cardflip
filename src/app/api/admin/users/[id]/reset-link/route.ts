import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { findUserById, isDemoUser } from "@/lib/server/users";
import { issueResetToken } from "@/lib/server/passwordReset";
import { isMailConfigured, sendPasswordResetEmail } from "@/lib/server/mail";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Admin-issued password reset. Returns the one-time link so the admin can
 * hand it to the user however they like (and, when mail is configured and
 * `send: true`, also emails it). The link is shown exactly once — it isn't
 * stored in clear anywhere.
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { id } = await params;
    const user = await findUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (isDemoUser(user)) {
      return NextResponse.json(
        { error: "The demo account has no password to reset." },
        { status: 400 },
      );
    }
    const body = await req.json().catch(() => ({}));
    const wantEmail = Boolean(body?.send) && isMailConfigured();

    const issued = await issueResetToken(user);
    let emailed = false;
    if (wantEmail) {
      try {
        await sendPasswordResetEmail(user.email, issued.url);
        emailed = true;
      } catch (err) {
        console.error("Admin reset email failed:", err);
      }
    }
    return NextResponse.json({
      url: issued.url,
      expiresAt: issued.expiresAt,
      emailed,
      mailConfigured: isMailConfigured(),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
