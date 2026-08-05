import { NextResponse } from "next/server";
import { findUserByEmail, toPublicUser } from "@/lib/server/users";
import { verifyPassword } from "@/lib/server/password";
import { createSession } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const user = email ? findUserByEmail(email) : null;

  // Same message whether the email is unknown or the password is wrong, so
  // a login attempt can't be used to enumerate registered accounts.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Incorrect email or password." },
      { status: 401 },
    );
  }

  const session = createSession(user.id);
  const res = NextResponse.json({ user: toPublicUser(user) });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return res;
}
