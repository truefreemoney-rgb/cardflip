import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieOptions, adminSession, issueAdminSession } from "@/lib/server/adminGate";

/**
 * Keep-alive for the console (lib/adminAuth.ts: idle timeout). AdminKeepAlive
 * posts here while the tab is visible and the person is clicking or typing;
 * a valid cookie is re-signed for the same role and the same sign-in with a
 * fresh expiry, never past that sign-in's hard limit (#32). An expired,
 * signed-out or missing cookie gets 401 and the client goes to /admin/login.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await adminSession();
  if (!session) return NextResponse.json({ error: "Signed out" }, { status: 401 });
  const { token, expiresAt } = issueAdminSession(session.role, session.loginAt);
  const res = NextResponse.json({ ok: true, expiresAt, role: session.role });
  res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions(expiresAt));
  return res;
}
