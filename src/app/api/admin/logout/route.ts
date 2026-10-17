import { NextResponse } from "next/server";
import { ADMIN_COOKIE, endAdminSession } from "@/lib/server/adminGate";

/** Sign Out (#32): the sign-in is recorded as ended, so a copy of this cookie stops working too; then the cookie goes. */
export async function POST() {
  await endAdminSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
