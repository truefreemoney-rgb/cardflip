import { NextResponse, after } from "next/server";
import { requireAdminOwner } from "@/lib/server/auth";
import { dailyStatus, runDailyIfDue } from "@/lib/server/dailyJobs";
import { adminFailure } from "@/lib/server/adminGate";

/**
 * Admin: current daily-job status, or kick a run now (background).
 *
 * The after() run inherits this route's maxDuration; without it Vercel
 * killed the job seconds after daily_started_at was written, and the
 * console showed "running" until the stale-start window lapsed (09-09).
 * 300s is the Pro ceiling, same as the cron routes.
 */
export const maxDuration = 300;

export async function GET() {
  try {
    await requireAdminOwner();
    return NextResponse.json({ status: await dailyStatus() });
  } catch (err) {
    return adminFailure(err);
  }
}

export async function POST() {
  try {
    await requireAdminOwner();
    const status = await dailyStatus();
    if (status.running) return NextResponse.json({ started: false, status });
    after(() => runDailyIfDue(true));
    return NextResponse.json({ started: true, status: { ...status, running: true } });
  } catch (err) {
    return adminFailure(err);
  }
}
