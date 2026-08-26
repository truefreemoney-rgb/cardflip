import { NextResponse } from "next/server";
import { findUserByEmail, toPublicUser } from "@/lib/server/users";
import { verifyPassword } from "@/lib/server/password";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

export async function POST(req: Request) {
  // Brute-force backstop, per IP.
  const limited = limitOrRespond(`auth:login:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const user = email ? await findUserByEmail(email) : null;

  // Same message whether the email is unknown or the password is wrong, so
  // a login attempt can't be used to enumerate registered accounts.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Incorrect email or password." },
      { status: 401 },
    );
  }

  const session = await createSession(user.id);
  const res = NextResponse.json({ user: toPublicUser(user) });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
}
