import { NextRequest, NextResponse } from "next/server";
import { recordCronResult, runPokemonSteps } from "@/lib/server/dailyJobs";
import { cronAuthError } from "@/lib/server/cronAuth";
import { sendErrorDigestIfNeeded } from "@/lib/server/errorDigest";
import { publishSocial } from "@/lib/server/socialPublish";
import { SOCIAL_SITES } from "@/lib/server/socialSites";

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
  // Last step of the day: tell the owner if prod has been throwing.
  const errorDigest = await sendErrorDigestIfNeeded();
  // Then the social autopilot (docs/SOCIAL-AUTOPILOT.md): posts on Tue/Thu/
  // Sat to every connected site, once; rides this cron because Hobby
  // allows two. Never lets a social failure fail the price run.
  let social: unknown;
  try {
    social = await publishSocial({ origin: req.nextUrl.origin, sites: SOCIAL_SITES });
  } catch (err) {
    social = { error: err instanceof Error ? err.message : String(err) };
  }
  return NextResponse.json({ ...result, ms: Date.now() - t0, errorDigest, social });
}
