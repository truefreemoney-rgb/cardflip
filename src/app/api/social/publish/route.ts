import { NextRequest, NextResponse } from "next/server";
import { cronAuthError } from "@/lib/server/cronAuth";
import { publishSocial } from "@/lib/server/socialPublish";
import { SOCIAL_SITES } from "@/lib/server/socialSites";

/**
 * Social autopilot publisher (docs/SOCIAL-AUTOPILOT.md §1).
 *   GET|POST /api/social/publish?key=<CRON_SECRET>            → posts if it is a post day and not yet posted
 *   ...&force=1                                              → posts now (re-posts if already done today)
 *   ...&dry=1                                                → says what would go out, posts nothing
 *   ...&day=YYYY-MM-DD                                       → another day's drafts
 * The daily Pokémon cron calls publishSocial() itself; this route is the
 * manual handle (and the one the /admin/social "Post now" button uses).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function run(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const rawDay = q.get("day");
  const report = await publishSocial({
    origin: req.nextUrl.origin,
    sites: SOCIAL_SITES,
    force: q.get("force") === "1",
    dry: q.get("dry") === "1",
    day: rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined,
  });
  return NextResponse.json(report);
}

export const GET = run;
export const POST = run;
