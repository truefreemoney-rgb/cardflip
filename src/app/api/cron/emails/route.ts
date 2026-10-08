import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { CAMPAIGN_IDS, sweepCampaigns, type CampaignId } from "@/lib/server/campaigns";
import { cronAuthError } from "@/lib/server/cronAuth";

/**
 * The weekly mails (lib/server/campaigns.ts, docs/EMAILS.md). Vercel Cron
 * pings this at both DST offsets of each send time (vercel.json); the sweep
 * keeps the ping that lands in the Eastern send hour and skips the other.
 *   Tue + Thu 10:00am ET   scans / your cards
 *   Sun 6:30pm ET          this week in cards
 *   GET /api/cron/emails                 → Bearer CRON_SECRET (Vercel), ?key=, or the owner cookie
 *   ...&force=1                          → ignore the day/hour (still needs the switch on, still capped)
 *   ...&only=scans|cards|week            → that mail instead of today's
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) {
    try {
      await requireAdminOwner();
    } catch (err) {
      if (err instanceof AuthError) return denied;
      throw err;
    }
  }
  const q = req.nextUrl.searchParams;
  const only = q.get("only");
  const opts = {
    force: q.get("force") === "1",
    ...(only && (CAMPAIGN_IDS as readonly string[]).includes(only) ? { only: only as CampaignId } : {}),
  };
  return NextResponse.json(await sweepCampaigns(Date.now(), opts));
}
