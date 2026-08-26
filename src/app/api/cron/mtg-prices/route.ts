import { NextRequest, NextResponse } from "next/server";
import { recordCronResult, runMtgStep } from "@/lib/server/dailyJobs";
import { cronAuthError } from "@/lib/server/cronAuth";

/**
 * Vercel Cron: the Magic half of the daily refresh (Scryfall bulk scan —
 * the heaviest step, so it gets a function to itself). On Fly this work
 * runs inside /api/cron/daily instead; both write the same meta keys.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const t0 = Date.now();
  const mtg = await runMtgStep();
  await recordCronResult({ mtg, ms: Date.now() - t0 }, !("error" in mtg));
  return NextResponse.json({ mtg, ms: Date.now() - t0 });
}
