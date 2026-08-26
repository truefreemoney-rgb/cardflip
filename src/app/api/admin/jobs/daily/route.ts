import { NextResponse, after } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { dailyStatus, runDailyIfDue } from "@/lib/server/dailyJobs";

/** Admin: current daily-job status, or kick a run now (background). */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ status: await dailyStatus() });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}

export async function POST() {
  try {
    await requireAdmin();
    const status = await dailyStatus();
    if (status.running) return NextResponse.json({ started: false, status });
    after(() => runDailyIfDue(true));
    return NextResponse.json({ started: true, status: { ...status, running: true } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
