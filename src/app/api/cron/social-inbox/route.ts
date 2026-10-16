import { NextRequest, NextResponse } from "next/server";
import { cronAuthError } from "@/lib/server/cronAuth";
import { reportStaleOnceADay } from "@/lib/server/healthChecks";
import { sweepSocialInbox } from "@/lib/server/socialInbox";
import { refreshSocialPosts } from "@/lib/server/socialPosts";

/**
 * Social inbox sweep: read every site's comments and replies on our posts,
 * hide spam, draft replies, leave one line on the board. Vercel Cron pings
 * it an hour after each autopilot slot (vercel.json: 8am / 2pm / 8pm
 * Eastern, both DST hours). The owner can also hit it from the inbox page
 * ("Check now").
 *   GET /api/cron/social-inbox → Bearer CRON_SECRET (Vercel) or ?key=
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  // Keys only (10-16 audit): the owner cookie is SameSite=Lax, so it rode along on a cross-site GET and any page
  // Chris opened could fire ?force=1. Nothing in the console calls these; run by hand with the key.
  if (denied) return denied;
  const started = Date.now();
  // Backstop for a dead price cron: files the stale backup / price run line (once a day).
  await reportStaleOnceADay();
  // Same ping also stores every post's counts for /admin/social/posts (the page never reads a platform itself).
  // The optimizer no longer rides this ping (10-03): it runs in the evening as the first step of the night render.
  const [report, posts] = await Promise.all([sweepSocialInbox(), refreshSocialPosts()]);
  return NextResponse.json({ ...report, posts: { stored: posts.stored, sites: posts.sites }, ms: Date.now() - started });
}
