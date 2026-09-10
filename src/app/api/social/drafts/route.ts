import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { socialDrafts } from "@/lib/server/social";
import { GAMES, siteStatus } from "@/lib/server/socialPublish";
import { SOCIAL_SITES } from "@/lib/server/socialSites";
import { todayUtc } from "@/lib/priceSeries";

/**
 * Today's drafts as JSON (docs/SOCIAL-AUTOPILOT.md §1) plus which sites are
 * connected and when they last posted. Owner cookie or ?key=CRON_SECRET,
 * the same gate as /api/social/image.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const key = req.nextUrl.searchParams.get("key");
  if (!(secret && key && key === secret)) {
    try {
      await requireAdminOwner();
    } catch (err) {
      if (err instanceof AuthError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      throw err;
    }
  }
  const raw = req.nextUrl.searchParams.get("day");
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayUtc();
  const [drafts, sites] = await Promise.all([
    Promise.all(GAMES.map((g) => socialDrafts(g, day))).then((d) => d.flat()),
    siteStatus(SOCIAL_SITES),
  ]);
  return NextResponse.json({ day, drafts, sites });
}
