import { NextRequest, NextResponse } from "next/server";
import { dailyStatus, runDailyIfDue } from "@/lib/server/dailyJobs";

/**
 * External trigger for the once-a-day price refresh — for the days nobody
 * opens the app (scale-to-zero means no in-process timer fires either).
 * Any pinger works (cron-job.org, a Claude scheduled task, a GitHub Action):
 *   GET /api/cron/daily?key=<CRON_SECRET>          → runs if due
 *   GET /api/cron/daily?key=<CRON_SECRET>&force=1  → runs now
 * Fly's proxy wakes the machine for the request; the job continues after
 * the response. Without CRON_SECRET set the route is off (503).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (key !== secret) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  // Awaited on purpose: the pinger's timeout is the only thing keeping the
  // machine awake long enough to finish, and its log shows the result.
  const result = await runDailyIfDue(force);
  return NextResponse.json({ ...result, status: dailyStatus() });
}
