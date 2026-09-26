import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { getSetting, setSetting } from "@/lib/server/settings";
import { tiktokExchangeCode, TIKTOK_STATE_KEY } from "@/lib/server/sites/tiktok";

/**
 * GET /api/social/tiktok/callback?code&state — TikTok sends the owner's
 * browser back here after consent. The state must match the one ../connect
 * parked (single use, 15 minutes), the code is swapped for tokens
 * (settings social_token:tiktok), and the owner lands on /admin/social with
 * ?tiktok=connected or ?tiktok=error:<why>.
 */
export const dynamic = "force-dynamic";
const STATE_TTL_MS = 15 * 60_000;

export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/admin/social?tiktok=${encodeURIComponent(q)}`, req.nextUrl.origin));
  try {
    await requireAdminOwner();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: "owner only" }, { status: 403 });
    throw err;
  }
  const p = req.nextUrl.searchParams;
  const denied = p.get("error");
  if (denied) return back(`error:${p.get("error_description") ?? denied}`);
  const code = p.get("code");
  const state = p.get("state");
  if (!code || !state) return back("error:no code from TikTok");
  let parked: { state?: string; at?: number } = {};
  try {
    parked = JSON.parse((await getSetting(TIKTOK_STATE_KEY)) ?? "{}") as typeof parked;
  } catch {
    /* treated as no state */
  }
  await setSetting(TIKTOK_STATE_KEY, "");
  if (!parked.state || parked.state !== state || !parked.at || Date.now() - parked.at > STATE_TTL_MS) return back("error:state mismatch, try connect again");
  try {
    await tiktokExchangeCode(code, req.nextUrl.origin);
  } catch (err) {
    return back(`error:${err instanceof Error ? err.message : String(err)}`);
  }
  return back("connected");
}
