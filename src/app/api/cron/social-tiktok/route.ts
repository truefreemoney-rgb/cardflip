import { NextRequest, NextResponse } from "next/server";
import { presentedKey, secretEqual } from "@/lib/server/secretEqual";
import { cronAuthError } from "@/lib/server/cronAuth";
import { runSocialOptimize } from "@/lib/server/socialOptimize";
import { alertPackageFailure, notifyPackageReady, packageSafetyNet, tiktokTargetDay } from "@/lib/server/socialTiktok";

/**
 * Safety net for the night TikTok package (Chris 09-30: he posts TikTok by
 * hand; the render job builds tomorrow's three videos every evening, see
 * lib/socialTiktok.ts). GitHub's cron can run hours late, so Vercel Cron
 * pings this at 9:15pm Eastern (vercel.json, both DST hours) and, for a plan
 * pushed overnight, at 5:45am Eastern too. If tomorrow's package is complete
 * and current it mails the owner once ("Tomorrow's TikTok Videos Are Ready");
 * if any slot is missing, or was made under a day plan that has since
 * changed, it dispatches the social-post workflow's TikTok run, which remakes
 * only those slots.
 *   GET /api/cron/social-tiktok          → Bearer CRON_SECRET (Vercel), Bearer SOCIAL_POST_KEY (GitHub) only
 *   ...&dry=1                            → report only, never dispatch
 *   ...&force=1                          → check outside the windows and dispatch even right after a dispatch
 *   ...&day=YYYY-MM-DD                   → check that day's package
 *   ...&notify=1                         → the render job's last step: mail once if ready (tomorrow's package only), forget the dispatch, never dispatch
 *   ...&failed=1[&why=…]                 → the render job failed: the failure alert (once a day), never dispatch
 */
export const dynamic = "force-dynamic";

/** The GitHub schedule's own key (secret SOCIAL_POST_KEY), so CRON_SECRET never leaves Vercel. */
function postKeyOk(req: NextRequest): boolean {
  const k = process.env.SOCIAL_POST_KEY;
  return secretEqual(presentedKey(req), k);
}

export async function GET(req: NextRequest) {
  const denied = postKeyOk(req) ? null : cronAuthError(req);
  // Keys only (10-16 audit): the owner cookie is SameSite=Lax, so it rode along on a cross-site GET and any page
  // Chris opened could fire ?force=1. Nothing in the console calls these; run by hand with the key.
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const rawDay = q.get("day");
  const day = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined;
  if (q.get("failed") === "1") {
    const target = day ?? tiktokTargetDay();
    const alerted = await alertPackageFailure(target, (q.get("why") ?? "the render job failed").slice(0, 200));
    return NextResponse.json({ day: target, alerted });
  }
  if (q.get("notify") === "1") {
    const target = day ?? tiktokTargetDay();
    return NextResponse.json({ day: target, mailed: await notifyPackageReady(target) });
  }
  const dry = q.get("dry") === "1";
  // Picks before videos (10-03): the optimizer writes the target day's 7am/7pm picks first (once per day; a no-op when the
  // render already ran it), so a package checked here is judged against the plan it is meant to post, never an older one.
  const target = day ?? tiktokTargetDay();
  const optimized = dry
    ? null
    : await runSocialOptimize(Date.now(), { target }).catch((err) => {
        console.warn("social: optimizer failed", err instanceof Error ? err.message : err);
        return null;
      });
  const report = await packageSafetyNet({ force: q.get("force") === "1", dry, day });
  if (optimized) Object.assign(report, { optimizer: { forDay: optimized.forDay, picks: optimized.picks } });
  return NextResponse.json(report, { status: report.action === "dispatch-failed" ? 502 : 200 });
}
