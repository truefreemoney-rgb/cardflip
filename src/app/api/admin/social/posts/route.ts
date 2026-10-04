import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { listSocialPosts, refreshSocialPosts } from "@/lib/server/socialPosts";
import { AUTO_REPLY_KEY, sweepSocialInbox } from "@/lib/server/socialInbox";
import { OPT_OFF_KEY } from "@/lib/server/socialOptimize";
import { setSetting } from "@/lib/server/settings";

/**
 * Owner-only data for /admin/social/posts.
 *   GET  ?site=&waiting=1&commented=1&before=<iso>&limit=  → PostsPage (database only, cheap)
 *   POST { action: "refresh" }                  → reads every site live (counts + comments), then returns the first page
 * Comment actions stay on /api/admin/social/inbox.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function query(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const site = p.get("site")?.trim() || null;
  const before = p.get("before")?.trim() || null;
  const limit = Number(p.get("limit") ?? 40);
  return { site, before, waiting: p.get("waiting") === "1", commented: p.get("commented") === "1", limit: Number.isFinite(limit) ? limit : 40 };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminOwner();
    return NextResponse.json(await listSocialPosts(query(req)));
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminOwner();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const body = (await req.json().catch(() => null)) as { action?: string; site?: string | null; waiting?: boolean; commented?: boolean; on?: boolean } | null;
  if (body?.action === "autoReply") {
    await setSetting(AUTO_REPLY_KEY, body.on === false ? "0" : "1");
    return NextResponse.json({ autoReply: body.on !== false });
  }
  // The optimization loop's Off switch on /admin/social: off = it scores and reports, and changes nothing.
  if (body?.action === "optimizer") {
    await setSetting(OPT_OFF_KEY, body.on === false ? "1" : "");
    return NextResponse.json({ optimizer: body.on !== false });
  }
  if (body?.action !== "refresh") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const started = Date.now();
  // Counts and comments in parallel: the two never touch the same rows.
  const [pulse, sweep] = await Promise.all([refreshSocialPosts(), sweepSocialInbox()]);
  const page = await listSocialPosts({ site: body.site ?? null, waiting: Boolean(body.waiting), commented: Boolean(body.commented) });
  const errors = [...pulse.sites.filter((s) => s.error).map((s) => `${s.label}: ${s.error}`), ...sweep.sites.filter((s) => s.error).map((s) => `${s.label} comments: ${s.error}`)];
  return NextResponse.json({
    ...page,
    refresh: { posts: pulse.stored, added: sweep.added, hidden: sweep.hidden, replied: sweep.replied, errors, ms: Date.now() - started },
  });
}
