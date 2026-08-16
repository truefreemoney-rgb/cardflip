import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/server/adminGate";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
