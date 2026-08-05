import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { getPlatformStats } from "@/lib/server/cards";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ stats: getPlatformStats() });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
