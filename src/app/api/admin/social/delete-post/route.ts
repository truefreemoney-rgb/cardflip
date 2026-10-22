import { NextRequest, NextResponse } from "next/server";
import { requireAdminOwner } from "@/lib/server/auth";
import { metaReadCreds } from "@/lib/server/sites/meta";
import { xSignedJson } from "@/lib/server/sites/x";
import { blueskyCall, blueskySession } from "@/lib/server/sites/bluesky";
import { adminFailure } from "@/lib/server/adminGate";

/**
 * Owner-only: take one of OUR posts down on its site, by the URL social_post_log stored (10-16: the 1pm head to head went
 * out with a junk "slipped 78.8%"). The log row stays, so the autopilot never re-posts that slot on its own.
 *   POST { site: "bluesky" | "x" | "facebook" | "instagram" | "threads", url } -> { ok: true, id } | { error }
 * Instagram's API may refuse deletes; the error says so and the post comes down by hand in the app.
 */
export const dynamic = "force-dynamic";

/** Our recent Threads / Instagram media, matched to the post URL's shortcode. */
async function metaIdFor(base: string, userId: string, token: string, edge: "threads" | "media", url: string): Promise<string> {
  const code = url.replace(/\/+$/, "").split("/").pop() ?? "";
  const res = await fetch(`${base}/${userId}/${edge}?fields=id,permalink&limit=25&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${edge} list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const list = ((await res.json()) as { data?: { id: string; permalink?: string }[] }).data ?? [];
  const hit = list.find((m) => code && m.permalink?.includes(code));
  if (!hit) throw new Error(`no recent post matches ${code}`);
  return hit.id;
}

async function metaDelete(base: string, id: string, token: string, label: string): Promise<void> {
  const res = await fetch(`${base}/${id}?access_token=${encodeURIComponent(token)}`, { method: "DELETE", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${label} delete ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function deletePost(site: string, url: string): Promise<string> {
  switch (site) {
    case "bluesky": {
      const session = await blueskySession();
      if (!session) throw new Error("Bluesky not connected");
      const rkey = url.replace(/\/+$/, "").split("/").pop();
      if (!rkey) throw new Error("bad Bluesky url");
      await blueskyCall("com.atproto.repo.deleteRecord", { repo: session.did, collection: "app.bsky.feed.post", rkey }, session);
      return rkey;
    }
    case "x": {
      const id = url.match(/status\/(\d+)/)?.[1];
      if (!id) throw new Error("bad X url");
      const res = await xSignedJson("DELETE", `/2/tweets/${id}`, {});
      if (!res) throw new Error("X not connected");
      if (!res.ok) throw new Error(`x delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return id;
    }
    case "facebook": {
      const fb = (await metaReadCreds()).facebook;
      if (!fb) throw new Error("Facebook not connected");
      const id = url.match(/\/videos\/(\d+)/)?.[1] ?? url.match(/\/posts\/(\d+)/)?.[1] ?? url.match(/(\d+_\d+)/)?.[1];
      if (!id) throw new Error("bad Facebook url");
      await metaDelete(fb.base, id, fb.token, "facebook");
      return id;
    }
    case "instagram":
    case "threads": {
      const c = (await metaReadCreds())[site];
      if (!c) throw new Error(`${site} not connected`);
      const id = await metaIdFor(c.base, c.userId, c.token, site === "threads" ? "threads" : "media", url);
      await metaDelete(c.base, id, c.token, site);
      return id;
    }
    default:
      throw new Error(`${site}: delete not supported`);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminOwner();
  } catch (err) {
    return adminFailure(err);
  }
  const body = (await req.json().catch(() => null)) as { site?: string; url?: string } | null;
  const site = body?.site?.trim();
  const url = body?.url?.trim();
  if (!site || !url) return NextResponse.json({ error: "site and url required" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, id: await deletePost(site, url) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
