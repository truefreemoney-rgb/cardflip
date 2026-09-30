import { NextRequest, NextResponse } from "next/server";
import { recordCronResult, runMtgStep } from "@/lib/server/dailyJobs";
import { cronAuthError } from "@/lib/server/cronAuth";
import { reportServerError } from "@/lib/server/errorLog";

/**
 * Vercel Cron: the Magic half of the daily refresh (Scryfall bulk scan —
 * the heaviest step, so it gets a function to itself). On Fly this work
 * runs inside /api/cron/daily instead; both write the same meta keys.
 *
 * 09-30: a healthy run took ~290s of the old 300s cap, so any slow Turso
 * day killed it with no trace (09-16 → 09-23: no Magic prices at all), and
 * one IOERR killed 09-30's. Now: 800s (Vercel Pro's cap), the bulk writes
 * retry transient errors, a second cron (?resume=1 in vercel.json) finishes
 * a run that still died, and a failure lands on the Errors page (it used to
 * be swallowed into daily_last_result and answered 200).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const t0 = Date.now();
  const mtg = await runMtgStep({ skipIfDone: true });
  if ("skipped" in mtg) return NextResponse.json({ mtg, ms: Date.now() - t0 });
  if ("error" in mtg) await reportServerError("cron/mtg-prices", new Error(mtg.error));
  try {
    await recordCronResult({ mtg, ms: Date.now() - t0 }, !("error" in mtg));
  } catch (err) {
    await reportServerError("cron/mtg-prices result write", err);
  }
  return NextResponse.json({ mtg, ms: Date.now() - t0 }, { status: "error" in mtg ? 500 : 200 });
}
