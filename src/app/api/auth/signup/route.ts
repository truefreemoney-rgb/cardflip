import { NextResponse } from "next/server";
import { createUser, findUserByEmail, toPublicUser } from "@/lib/server/users";
import { createSession, sessionCookieOptions } from "@/lib/server/sessions";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { attachReferral } from "@/lib/server/referrals";

export async function POST(req: Request) {
  // Brute-force backstop, per IP.
  const limited = limitOrRespond(`auth:signup:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  // Same cap as admin create and account PATCH.
  if (name.length > 80) {
    return NextResponse.json({ error: "Name must be 80 characters or fewer." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 },
    );
  }

  if (await findUserByEmail(email)) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 },
    );
  }

  const user = await createUser(name, email, password);
  // Invite a friend: ?ref=CODE captured on the landing page rides along.
  // Best effort — a bad or stale code never blocks the signup.
  if (typeof body?.ref === "string" && body.ref) await attachReferral(user.id, body.ref).catch(() => {});
  const session = await createSession(user.id);

  const res = NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
}
