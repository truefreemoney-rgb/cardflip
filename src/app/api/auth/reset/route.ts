import { NextResponse } from "next/server";
import { toPublicUser } from "@/lib/server/users";
import {
  consumeResetToken,
  passwordProblem,
  peekResetToken,
} from "@/lib/server/passwordReset";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/** Is this link still good? Lets the page say so before the seller types a password. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const user = token ? await peekResetToken(token) : null;
  return NextResponse.json({ valid: Boolean(user), email: user?.email ?? null });
}

/** Set the new password from a link, and log the seller straight in. */
export async function POST(req: Request) {
  // Brute-force backstop, per IP.
  const limited = limitOrRespond(`auth:reset:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const problem = passwordProblem(password);
  if (!token || problem) {
    return NextResponse.json(
      { error: "invalid", message: problem ?? "Missing reset link." },
      { status: 400 },
    );
  }

  const user = await consumeResetToken(token, password);
  if (!user) {
    return NextResponse.json(
      {
        error: "expired",
        message: "That reset link is invalid or has expired. Request a new one.",
      },
      { status: 400 },
    );
  }

  const session = await createSession(user.id);
  const res = NextResponse.json({ user: toPublicUser(user) });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
}
