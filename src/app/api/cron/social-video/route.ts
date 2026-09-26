import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { cronAuthError } from "@/lib/server/cronAuth";
import { getSetting } from "@/lib/server/settings";
import { eastern } from "@/lib/server/socialPublish";
import { parseVideoSpec, videoKey } from "@/lib/socialVideo";
import { BOARD_REPO, ghHeaders } from "@/lib/server/boardRuns";

/**
 * Safety net for the 7am social video (Chris 09-26, the 6:50 GitHub cron
 * was two hours late: "this cannot happen again"). Vercel Cron pings this
 * at 6:40 Eastern (vercel.json, both DST hours). If today's set-spotlight
 * video is already registered it says so and stops. If not, it dispatches
 * the social-post workflow render-only, so the MP4 is on Blob before the
 * 7:05 publish cron; the publisher still falls back to the picture if the
 * render is not done by then.
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
  const { day } = eastern();
  const key = videoKey("pokemon", "set", day);
  const spec = parseVideoSpec(await getSetting(key));
  if (spec && q.get("force") !== "1") return NextResponse.json({ day, registered: true, url: spec.url, renderedAt: spec.renderedAt });
  if (q.get("dry") === "1") return NextResponse.json({ day, registered: Boolean(spec), dispatched: false, dry: true });
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
  return NextResponse.json({ day, registered: Boolean(spec), dispatched: true });
}
