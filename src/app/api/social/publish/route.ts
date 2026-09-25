import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { cronAuthError } from "@/lib/server/cronAuth";
import { publishSocial, SLOT_ORDER, type Slot } from "@/lib/server/socialPublish";
import { SOCIAL_SITES } from "@/lib/server/socialSites";

/**
 * Social autopilot publisher (docs/SOCIAL-AUTOPILOT.md §1).
 *   GET|POST /api/social/publish?key=<CRON_SECRET>            → posts if it is a post day and not yet posted
 *   ...&slot=morning|midday|evening                           → that slot (default: the slot for the current Eastern hour)
 *   ...&force=1                                              → posts now (re-posts if the slot already went out)
 *   ...&dry=1                                                → says what would go out, posts nothing
 *   ...&day=YYYY-MM-DD                                       → another day's drafts
 * The daily Pokémon cron calls publishSocial() itself; this route is the
 * manual handle. Owner cookie (the /admin/social "Post now" button) or
 * ?key=CRON_SECRET / Bearer (routine, manual pinger) — same gate as
 * /api/social/image and /api/social/drafts.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The schedule's own key (GitHub secret SOCIAL_POST_KEY), so CRON_SECRET never leaves Vercel. */
function postKeyOk(req: NextRequest): boolean {
  const k = process.env.SOCIAL_POST_KEY;
  const given = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(k) && given === k;
}

async function run(req: NextRequest) {
  const denied = postKeyOk(req) ? null : cronAuthError(req);
  if (denied) {
    try {
      await requireAdminOwner();
    } catch (err) {
      if (err instanceof AuthError) return denied;
      throw err;
    }
  }
  const q = req.nextUrl.searchParams;
  const rawDay = q.get("day");
  const rawSlot = q.get("slot");
  const slot = SLOT_ORDER.find((s) => s === rawSlot) as Slot | undefined;
  const report = await publishSocial({
    slot,
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
