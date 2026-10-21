import { NextRequest, NextResponse } from "next/server";
import { dailyStatus, runDailyIfDue } from "@/lib/server/dailyJobs";
import { cronAuthError } from "@/lib/server/cronAuth";
import { sendErrorDigestIfNeeded } from "@/lib/server/errorDigest";

/**
 * External trigger for the once-a-day price refresh — for the days nobody
 * opens the app (scale-to-zero means no in-process timer fires either).
 * Any pinger works (Vercel cron, cron-job.org, a GitHub Action), with the
 * secret as a Bearer header (the ?key= query was dropped 10-14, secretEqual.ts):
 *   GET /api/cron/daily            Authorization: Bearer <CRON_SECRET>  → runs if due
 *   GET /api/cron/daily?force=1    Authorization: Bearer <CRON_SECRET>  → runs now
 * Without CRON_SECRET set the route is off (503).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const force = req.nextUrl.searchParams.get("force") === "1";
  // Awaited on purpose: the pinger's timeout is the only thing keeping the
  // machine awake long enough to finish, and its log shows the result.
  const result = await runDailyIfDue(force);
  const errorDigest = result.ran ? await sendErrorDigestIfNeeded() : undefined;
  return NextResponse.json({ ...result, status: await dailyStatus(), errorDigest });
}
