import { NextRequest, NextResponse } from "next/server";
import { recordCronResult, runPokemonSteps } from "@/lib/server/dailyJobs";
import { cronAuthError } from "@/lib/server/cronAuth";

/**
 * Vercel Cron: the Pokémon half of the daily refresh — TCGCSV group scan,
 * the pokemontcg.io sweep of held/looked-up cards, and the eBay sold-order
 * sweep folded in (Hobby plan allows only two daily crons). On Fly this
 * work runs inside /api/cron/daily instead; both write the same meta keys.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const t0 = Date.now();
  const result = await runPokemonSteps();
  await recordCronResult({ ...result, ms: Date.now() - t0 }, false);
  return NextResponse.json({ ...result, ms: Date.now() - t0 });
}
