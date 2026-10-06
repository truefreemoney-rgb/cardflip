import { recordPublishCrash } from "@/lib/server/socialCrash";
import { NextRequest, NextResponse } from "next/server";
import { presentedKey, secretEqual } from "@/lib/server/secretEqual";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { cronAuthError } from "@/lib/server/cronAuth";
import { publishSocial, SLOT_ORDER, type Slot } from "@/lib/server/socialPublish";
import { SOCIAL_SITES } from "@/lib/server/socialSites";
import { refreshMetaTokens } from "@/lib/server/sites/meta";

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
// Video posts poll Meta/Bluesky/X processing for up to a few minutes; sites run in parallel.
export const maxDuration = 300;

/** The schedule's own key (GitHub secret SOCIAL_POST_KEY), so CRON_SECRET never leaves Vercel. */
function postKeyOk(req: NextRequest): boolean {
  const k = process.env.SOCIAL_POST_KEY;
  return secretEqual(presentedKey(req), k);
}

/**
 * The owner cookie counts on a same-origin POST only (10-01 security sweep): the admin cookie is SameSite=Lax, so it rides
 * along on a cross-site top-level GET, and any page Chris opened could have fired ?force=1 at every site. The schedule and
 * pingers use the keys, which work on both methods; the console's Post Now is a POST.
 */
function cookieAllowed(req: NextRequest): boolean {
  if (req.method !== "POST") return false;
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin;
}

async function run(req: NextRequest) {
  const denied = postKeyOk(req) ? null : cronAuthError(req);
  if (denied) {
    if (!cookieAllowed(req)) return denied;
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
  // ...&site=tiktok → only that site (the per-site "post" link on /admin/social); unknown id = 400.
  const onlySite = q.get("site");
  const sites = onlySite ? SOCIAL_SITES.filter((s) => s.id === onlySite) : SOCIAL_SITES;
  if (onlySite && sites.length === 0) return NextResponse.json({ error: `unknown site ${onlySite}` }, { status: 400 });
  let report: Awaited<ReturnType<typeof publishSocial>>;
  try {
    report = await publishSocial({
      slot,
      origin: req.nextUrl.origin,
      sites,
      force: q.get("force") === "1",
      dry: q.get("dry") === "1",
      day: rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined,
    });
  } catch (err) {
    // The whole run fell over (10-02 9:51pm ET: a bare 500, no trace). Record it, mail Chris, and say why in the body.
    console.error("social publish crashed", err);
    const crash = await recordPublishCrash(err, { slot: slot ?? null });
    return NextResponse.json({ error: "publisher crashed", crash }, { status: 500 });
  }
  // Ride-along: renew the 60-day Instagram/Threads tokens weekly (never on a dry run).
  const tokens = q.get("dry") === "1" ? [] : await refreshMetaTokens().catch((err) => [{ site: "meta", status: "failed", reason: err instanceof Error ? err.message : String(err) }]);
  return NextResponse.json({ ...report, tokens });
}

export const GET = run;
export const POST = run;
