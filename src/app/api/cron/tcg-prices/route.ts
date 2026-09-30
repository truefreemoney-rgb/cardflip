import { NextRequest, NextResponse } from "next/server";
import { recordCronResult, runTcgStep } from "@/lib/server/dailyJobs";
import { cronAuthError } from "@/lib/server/cronAuth";

/**
 * Vercel Cron: Lorcana / One Piece / Yu-Gi-Oh! daily prices + history point
 * (lib/server/tcgPriceRefresh.ts). Runs before /api/cron/pokemon-prices so
 * that run's watchlist + card alerts see today's numbers for every game.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const t0 = Date.now();
  const tcg = await runTcgStep();
  await recordCronResult({ tcg, ms: Date.now() - t0 }, false);
  return NextResponse.json({ tcg, ms: Date.now() - t0 });
}
