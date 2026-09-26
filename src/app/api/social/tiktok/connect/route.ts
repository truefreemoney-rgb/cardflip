import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { setSetting } from "@/lib/server/settings";
import { tiktokAuthUrl, TIKTOK_STATE_KEY } from "@/lib/server/sites/tiktok";

/**
 * GET /api/social/tiktok/connect — owner only. Starts the TikTok OAuth
 * consent flow for the cardflipio account (the "connect" link on
 * /admin/social). A one-shot state token is parked in settings and checked
 * by ../callback.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdminOwner();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: "owner only" }, { status: 403 });
    throw err;
  }
  const state = randomBytes(16).toString("hex");
  await setSetting(TIKTOK_STATE_KEY, JSON.stringify({ state, at: Date.now() }));
  try {
    return NextResponse.redirect(tiktokAuthUrl(req.nextUrl.origin, state));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
