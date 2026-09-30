import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { cronAuthError } from "@/lib/server/cronAuth";
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
 *   GET /api/cron/social-tiktok          → Bearer CRON_SECRET (Vercel), ?key=, SOCIAL_POST_KEY (GitHub), or the owner cookie
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
  const given = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(k) && given === k;
}

export async function GET(req: NextRequest) {
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
  const report = await packageSafetyNet({ force: q.get("force") === "1", dry: q.get("dry") === "1", day });
  return NextResponse.json(report, { status: report.action === "dispatch-failed" ? 502 : 200 });
}
