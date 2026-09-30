import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { cronAuthError } from "@/lib/server/cronAuth";
import { eastern } from "@/lib/server/socialPublish";
import { middayVideo, packageSafetyNet, type NetReport } from "@/lib/server/socialTiktok";
import { BOARD_REPO, ghHeaders } from "@/lib/server/boardRuns";

/**
 * Safety net for the social video (Chris 09-26, the GitHub cron was two
 * hours late: "this cannot happen again"). The video posts at 1pm since
 * 09-27 (VIDEO_SLOT); Vercel Cron pings this at 12:40 Eastern (vercel.json,
 * both DST hours). Since 09-30 the night render (lib/socialTiktok.ts,
 * /api/cron/social-tiktok) makes tomorrow's 1pm video the evening before, so
 * this is the second line: it only has work when that render did not land.
 * If today's video (the video slot's kind, movers) is
 * already registered AND was made under the day plan in force now it says so
 * and stops. If not (missing, or made before a plan pushed since: the night
 * render draws it hours ahead, so "a row exists" no longer means "it is
 * right"), it dispatches the
 * social-post workflow render-only, so the MP4 is on Blob before the 1:05
 * publish cron; the publisher still falls back to the picture if the render
 * is not done by then.
 * It also checks today's TikTok videos still to be posted (the 7pm one, and
 * the 1pm one when that render is not already dispatched here) the same way,
 * because a plan pushed after 7am is otherwise not seen until tonight
 * (lib/server/socialTiktok.ts packageSafetyNet, sameDay).
 *   GET /api/cron/social-video          → Bearer CRON_SECRET (Vercel), ?key=, or the owner cookie
 *   ...&dry=1                           → report only, never dispatch
 *   ...&force=1                         → dispatch even when registered (proves the token; the job exits at once)
 */
export const dynamic = "force-dynamic";

const WORKFLOW = "social-post.yml";

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
  const force = q.get("force") === "1";
  const dry = q.get("dry") === "1";
  const { day } = eastern();
  const { spec, state } = await middayVideo(day);
  const registered = state === "ready";
  /** Today's TikTok videos still to post, minus the 1pm one when this run is remaking it. */
  const tiktok = async (skipMidday: boolean): Promise<NetReport | { error: string }> => {
    try {
      return await packageSafetyNet({ sameDay: true, dry, skip: skipMidday ? ["midday"] : [] });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
  if (registered && !force) return NextResponse.json({ day, registered: true, url: spec?.url, renderedAt: spec?.renderedAt, tiktok: await tiktok(false) });
  if (dry) return NextResponse.json({ day, registered, stale: state === "stale", dispatched: false, dry: true, tiktok: await tiktok(true) });
  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ day, registered: false, dispatched: false, error: "GITHUB_TOKEN not configured" }, { status: 503 });
  const res = await fetch(`https://api.github.com/repos/${BOARD_REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { video: "1", render_only: "1" } }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status !== 204) {
    const text = await res.text().catch(() => "");
    console.error("social-video cron: dispatch failed", res.status, text.slice(0, 300));
    return NextResponse.json({ day, registered: false, dispatched: false, error: `GitHub ${res.status}` }, { status: 502 });
  }
  return NextResponse.json({ day, registered, stale: state === "stale", dispatched: true, tiktok: await tiktok(true) });
}
