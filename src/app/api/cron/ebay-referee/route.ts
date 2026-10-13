import { NextRequest, NextResponse } from "next/server";
import { cronAuthError } from "@/lib/server/cronAuth";
import { runEbayReferee } from "@/lib/server/ebayReferee";

/**
 * Vercel Cron: the nightly eBay referee (lib/server/ebayReferee.ts). Runs after
 * the morning price jobs (8:15am ET, again 8:45am ET to finish what the first
 * run's time limit left); a run reads at most its share of today's Browse
 * budget, so the second one stops at once when the first finished the day.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const run = await runEbayReferee();
  return NextResponse.json(run);
}
