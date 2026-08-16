import { NextResponse } from "next/server";
import { findUserByEmail, isDemoUser } from "@/lib/server/users";
import { issueResetToken } from "@/lib/server/passwordReset";
import { isMailConfigured, sendPasswordResetEmail } from "@/lib/server/mail";

/**
 * "Forgot password?" — emails a one-time reset link.
 *
 * The response never reveals whether the email is registered: an unknown
 * address gets the same "if that account exists, we sent it" 200 as a real
 * one. What it does say honestly is when the server can't send mail at all
 * (503), because then the seller needs a different path (support@), not a
 * promise of an email that will never come.
 */
export async function POST(req: Request) {
  if (!isMailConfigured()) {
    return NextResponse.json(
      {
        error: "unconfigured",
        message:
          "Email resets aren't switched on yet. Email support@superiormarketing.com and we'll reset it for you.",
      },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "invalid", message: "Enter your email." }, { status: 400 });
  }

  const user = findUserByEmail(email);
  if (user && !isDemoUser(user)) {
    try {
      const { url } = issueResetToken(user);
      await sendPasswordResetEmail(user.email, url);
    } catch (err) {
      // Logged, not surfaced: surfacing "send failed" only for real accounts
      // would leak which emails exist.
      console.error("Password reset email failed:", err);
    }
  }
  return NextResponse.json({ ok: true });
}
