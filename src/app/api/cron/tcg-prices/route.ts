import { NextRequest, NextResponse } from "next/server";
import { recordCronResult, runTcgStep } from "@/lib/server/dailyJobs";
import { cronAuthError } from "@/lib/server/cronAuth";
import { runLogCleanupIfDue } from "@/lib/server/logCleanup";

/**
 * Vercel Cron: Lorcana / One Piece / Yu-Gi-Oh! daily prices + history point
 * (lib/server/tcgPriceRefresh.ts). Runs before /api/cron/pokemon-prices so
 * that run's watchlist + card alerts see today's numbers for every game.
 * Also the weekly log retention (logCleanup.ts; a no-op read on the other six days).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const t0 = Date.now();
  const tcg = await runTcgStep();
  // The weekly log retention lived only in the all-in-one daily run, which the split crons
  // keep from ever coming due: it had not run since 10-08 (found 10-18). Own 30 s budget, never throws.
  const logCleanup = await runLogCleanupIfDue();
  await recordCronResult({ tcg, logCleanup, ms: Date.now() - t0 }, false);
  return NextResponse.json({ tcg, logCleanup, ms: Date.now() - t0 });
}
