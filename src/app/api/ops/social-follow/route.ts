import { NextResponse, type NextRequest } from "next/server";
import { secretEqual } from "@/lib/server/secretEqual";
import { cronAuthError } from "@/lib/server/cronAuth";
import { blueskyCall, blueskyGet, blueskySession } from "@/lib/server/sites/bluesky";
import outreach from "@/data/outreach/bluesky.json";

/**
 * Outreach follows (Chris 10-04: "start following relevant users ... card show
 * and store vendors would be high on the list, we really want their business").
 * Bluesky only: its login lives on Vercel as a sensitive env, so the follow has
 * to run here. The list is src/data/outreach/bluesky.json (card shops and
 * vendors, picked by hand from searches); each run follows the next few on it
 * that the account does not follow yet, a few seconds apart, and stops at the
 * first refusal. Paced on purpose: a young account following hundreds at once
 * reads as spam. GitHub social-follow.yml calls it daily; Bearer SOCIAL_POST_KEY
 * or CRON_SECRET.
 *
 *   POST ?max=25&dryRun=1  -> { following, followed: [handle], left, stopped? }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_RUN = 40;
const GAP_MS = 6_000;

interface Entry {
  did: string;
  handle: string;
}

function authError(req: NextRequest) {
  const k = process.env.SOCIAL_POST_KEY;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return secretEqual(given, k) ? null : cronAuthError(req);
}

export async function POST(req: NextRequest) {
  const denied = authError(req);
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const max = Math.min(MAX_PER_RUN, Math.max(1, Number(q.get("max")) || 25));
  const dryRun = q.get("dryRun") === "1";

  const session = await blueskySession();
  if (!session) return NextResponse.json({ error: "Bluesky not connected" }, { status: 503 });

  const following = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const j = await blueskyGet<{ follows?: { did: string }[]; cursor?: string }>(
      "app.bsky.graph.getFollows",
      { actor: session.did, limit: "100", ...(cursor ? { cursor } : {}) },
      session,
    );
    for (const f of j.follows ?? []) following.add(f.did);
    if (!j.cursor) break;
    cursor = j.cursor;
  }

  const todo = (outreach as Entry[]).filter((e) => e.did !== session.did && !following.has(e.did));
  const followed: string[] = [];
  let stopped: string | undefined;
  for (const e of todo.slice(0, max)) {
    if (dryRun) {
      followed.push(e.handle);
      continue;
    }
    try {
      await blueskyCall(
        "com.atproto.repo.createRecord",
        {
          repo: session.did,
          collection: "app.bsky.graph.follow",
          record: { $type: "app.bsky.graph.follow", subject: e.did, createdAt: new Date().toISOString() },
        },
        session,
      );
      followed.push(e.handle);
    } catch (err) {
      stopped = `${e.handle}: ${err instanceof Error ? err.message : String(err)}`;
      console.warn("social-follow stopped", stopped);
      break;
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  return NextResponse.json({ dryRun, following: following.size + (dryRun ? 0 : followed.length), followed, left: todo.length - followed.length, ...(stopped ? { stopped } : {}) });
}
