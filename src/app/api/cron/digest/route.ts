import { NextRequest, NextResponse } from "next/server";
import { cronAuthError } from "@/lib/server/cronAuth";
import { sweepWeeklyDigest } from "@/lib/server/digest";

/**
 * Manual trigger for the Sunday collection digest (the daily job runs it on
 * its own; this is for a look at the real mail):
 *   GET /api/cron/digest?key=<CRON_SECRET>          → sends if it is Sunday ET and not yet sent this week
 *   GET /api/cron/digest?key=<CRON_SECRET>&force=1  → sends now to everyone with cards (re-sends this week)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const force = req.nextUrl.searchParams.get("force") === "1";
  return NextResponse.json(await sweepWeeklyDigest(Date.now(), { force }));
}
