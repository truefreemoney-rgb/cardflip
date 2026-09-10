import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieOptions, adminRole, issueAdminSession } from "@/lib/server/adminGate";

/**
 * Keep-alive for the console (lib/adminAuth.ts: 5 min idle). AdminKeepAlive
 * posts here while the tab is visible and the person is clicking or typing;
 * a valid cookie is re-signed for the same role with a fresh expiry. An
 * expired or missing cookie gets 401 and the client goes to /admin/login.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const role = await adminRole();
  if (!role) return NextResponse.json({ error: "Signed out" }, { status: 401 });
  const { token, expiresAt } = issueAdminSession(role);
  const res = NextResponse.json({ ok: true, expiresAt, role });
  res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions(expiresAt));
  return res;
}
