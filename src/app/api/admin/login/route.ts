import { NextResponse } from "next/server";
import { verifyAdminCredentials } from "@/lib/adminAuth";
import { ADMIN_COOKIE, adminCookieOptions, issueAdminSession } from "@/lib/server/adminGate";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";

/** Admin panel sign-in: username + password → signed 12 h cookie. */
export async function POST(req: Request) {
  const limited = limitOrRespond(`auth:admin:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const user = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!verifyAdminCredentials(user, password)) {
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  const { token, expiresAt } = issueAdminSession();
  const res = NextResponse.json({ ok: true, expiresAt });
  res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions(expiresAt));
  return res;
}
