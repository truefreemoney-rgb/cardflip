import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { cronAuthError } from "@/lib/server/cronAuth";
import { sweepSocialInbox } from "@/lib/server/socialInbox";

/**
 * Social inbox sweep: read every site's comments and replies on our posts,
 * hide spam, draft replies, leave one line on the board. Vercel Cron pings
 * it an hour after each autopilot slot (vercel.json: 8am / 2pm / 8pm
 * Eastern, both DST hours). The owner can also hit it from the inbox page
 * ("Check now").
 *   GET /api/cron/social-inbox → Bearer CRON_SECRET (Vercel), ?key=, or the owner cookie
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) {
    try {
      await requireAdminOwner();
    } catch (err) {
      if (err instanceof AuthError) return denied;
      throw err;
    }
  }
  const started = Date.now();
  const report = await sweepSocialInbox();
  return NextResponse.json({ ...report, ms: Date.now() - started });
}
