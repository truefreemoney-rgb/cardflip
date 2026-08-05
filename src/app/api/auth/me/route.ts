import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { toPublicUser } from "@/lib/server/users";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user: user ? toPublicUser(user) : null });
}
