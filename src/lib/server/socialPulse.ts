/**
 * Social pulse: how the autopilot's posts are doing on each site — likes,
 * comments, shares, views, and Facebook's reaction faces — read straight
 * from each platform's "my posts" API with the same tokens the posters use
 * (Chris, 09-28: "get a pulse on the posts health").
 *
 * We store no post ids (socialPublish keeps only today's URIs), so every
 * site lists its own recent posts. Each site is independent: one failing
 * (X's free tier refuses reads, TikTok scope missing, token expired) shows
 * its error in place and the others still report. Every call is capped by
 * a timeout so the page never hangs on one platform.
 */

import { metaReadCreds } from "./sites/meta.ts";
import { xSignedGet } from "./sites/x.ts";
import { tiktokAccessToken } from "./sites/tiktok.ts";

export interface PulsePost {
  url: string;
  text: string;
  /** ISO timestamp of the post. */
  at: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  /** Facebook only: the reaction faces. */
  reactions?: Record<string, number>;
}

export interface SitePulse {
  site: string;
  label: string;
  /** False when the site is not connected at all (nothing to read). */
  connected: boolean;
  error: string | null;
  posts: PulsePost[];
  totals: { posts: number; likes: number; comments: number; shares: number; views: number | null; reactions?: Record<string, number> };
}

const LIMIT = 25;
const TIMEOUT_MS = 12_000;

async function getJson<T>(url: string, init: RequestInit = {}, step = url): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${step} ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sum = (posts: PulsePost[], key: "likes" | "comments" | "shares" | "views"): number =>
  posts.reduce((acc, p) => acc + (p[key] ?? 0), 0);

function finish(site: string, label: string, posts: PulsePost[], error: string | null = null, connected = true): SitePulse {
  posts.sort((a, b) => (a.at < b.at ? 1 : -1));
  const trimmed = posts.slice(0, LIMIT);
  const anyViews = trimmed.some((p) => p.views != null);
  let reactions: Record<string, number> | undefined;
  for (const p of trimmed) {
    if (!p.reactions) continue;
    reactions ??= {};
    for (const [k, v] of Object.entries(p.reactions)) reactions[k] = (reactions[k] ?? 0) + v;
  }
  return {
    site,
    label,
    connected,
    error,
    posts: trimmed,
    totals: {
      posts: trimmed.length,
      likes: sum(trimmed, "likes"),
      comments: sum(trimmed, "comments"),
      shares: sum(trimmed, "shares"),
      views: anyViews ? sum(trimmed, "views") : null,
      ...(reactions ? { reactions } : {}),
    },
  };
}

const notConnected = (site: string, label: string) => finish(site, label, [], "Not connected", false);
const failed = (site: string, label: string, err: unknown) =>
  finish(site, label, [], err instanceof Error ? err.message : String(err));

/* ---------- Bluesky: public feed, no token needed ---------- */

async function bluesky(): Promise<SitePulse> {
  const handle = process.env.BLUESKY_HANDLE?.trim();
  if (!handle) return notConnected("bluesky", "Bluesky");
  try {
    const feed = await getJson<{
      feed?: Array<{
        post: { uri: string; likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number; record?: { text?: string; createdAt?: string } };
        reason?: unknown;
      }>;
    }>(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${LIMIT}&filter=posts_no_replies`,
      {},
      "bluesky feed",
    );
    const posts: PulsePost[] = (feed.feed ?? [])
      .filter((f) => !f.reason)
      .map(({ post }) => ({
        url: `https://bsky.app/profile/${handle}/post/${post.uri.split("/").pop()}`,
        text: post.record?.text ?? "",
        at: post.record?.createdAt ?? "",
        likes: num(post.likeCount),
        comments: num(post.replyCount),
        shares: (post.repostCount ?? 0) + (post.quoteCount ?? 0),
        views: null,
      }));
    return finish("bluesky", "Bluesky", posts);
  } catch (err) {
    return failed("bluesky", "Bluesky", err);
  }
}

/* ---------- X: signed reads; the free tier may refuse ---------- */

async function x(): Promise<SitePulse> {
  try {
    const meRes = await xSignedGet("/2/users/me", { "user.fields": "username" });
    if (!meRes) return notConnected("x", "X");
    if (!meRes.ok) throw new Error(`x me ${meRes.status}: ${(await meRes.text()).slice(0, 200)}`);
    const me = (await meRes.json()) as { data?: { id: string; username?: string } };
    if (!me.data?.id) throw new Error("x me: no id");
    const handle = me.data.username ?? process.env.X_HANDLE ?? "cardflipio";
    const res = await xSignedGet(`/2/users/${me.data.id}/tweets`, {
      max_results: String(Math.max(5, Math.min(LIMIT, 100))),
      "tweet.fields": "public_metrics,created_at,text",
      exclude: "replies,retweets",
    });
    if (!res) return notConnected("x", "X");
    if (!res.ok) throw new Error(`x tweets ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as {
      data?: Array<{
        id: string;
        text?: string;
        created_at?: string;
        public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number; impression_count?: number };
      }>;
    };
    const posts: PulsePost[] = (body.data ?? []).map((t) => ({
      url: `https://x.com/${handle}/status/${t.id}`,
      text: t.text ?? "",
      at: t.created_at ?? "",
      likes: num(t.public_metrics?.like_count),
      comments: num(t.public_metrics?.reply_count),
      shares: (t.public_metrics?.retweet_count ?? 0) + (t.public_metrics?.quote_count ?? 0),
      views: num(t.public_metrics?.impression_count),
    }));
    return finish("x", "X", posts);
  } catch (err) {
    return failed("x", "X", err);
  }
}

/* ---------- Facebook: reactions by face ---------- */

const FACES = ["LIKE", "LOVE", "CARE", "HAHA", "WOW", "SAD", "ANGRY"] as const;

async function facebook(c: { base: string; pageId: string; token: string } | null): Promise<SitePulse> {
  if (!c) return notConnected("facebook", "Facebook");
  try {
    const faceFields = FACES.map((f) => `reactions.type(${f}).limit(0).summary(true).as(r_${f.toLowerCase()})`).join(",");
    const fields = `message,created_time,permalink_url,shares,comments.limit(0).summary(true),reactions.limit(0).summary(true),${faceFields}`;
    type FbPosts = {
      data?: Array<
        {
          id: string;
          message?: string;
          created_time?: string;
          permalink_url?: string;
          shares?: { count?: number };
          comments?: { summary?: { total_count?: number } };
          reactions?: { summary?: { total_count?: number } };
        } & Record<string, { summary?: { total_count?: number } } | unknown>
      >;
    };
    // /posts needs pages_read_user_content (an app-review permission); the
    // Page's OWN posts are readable through /published_posts with the
    // pages_read_engagement + pages_manage_posts the poster token already
    // carries (09-28: first open 400'd with error #10 on /posts).
    const read = (edge: string) =>
      getJson<FbPosts>(
        `${c.base}/${c.pageId}/${edge}?fields=${encodeURIComponent(fields)}&limit=${LIMIT}&access_token=${encodeURIComponent(c.token)}`,
        {},
        `facebook ${edge}`,
      );
    // Report the first edge's own error when both refuse — the fallback's
    // message names a permission the first one may not even need.
    const body = await read("published_posts").catch((first: unknown) =>
      read("feed").catch(() => {
        throw first;
      }),
    );
    const posts: PulsePost[] = (body.data ?? []).map((p) => {
      const reactions: Record<string, number> = {};
      for (const f of FACES) {
        const bucket = p[`r_${f.toLowerCase()}`] as { summary?: { total_count?: number } } | undefined;
        const n = bucket?.summary?.total_count ?? 0;
        if (n > 0) reactions[f.toLowerCase()] = n;
      }
      return {
        url: p.permalink_url ?? `https://www.facebook.com/${p.id}`,
        text: p.message ?? "",
        at: p.created_time ?? "",
        likes: num(p.reactions?.summary?.total_count),
        comments: num(p.comments?.summary?.total_count),
        shares: num(p.shares?.count) ?? 0,
        views: null,
        reactions,
      };
    });
    return finish("facebook", "Facebook", posts);
  } catch (err) {
    return failed("facebook", "Facebook", err);
  }
}

/* ---------- Instagram ---------- */

async function instagram(c: { base: string; userId: string; token: string } | null): Promise<SitePulse> {
  if (!c) return notConnected("instagram", "Instagram");
  try {
    const body = await getJson<{
      data?: Array<{ id: string; caption?: string; timestamp?: string; permalink?: string; like_count?: number; comments_count?: number }>;
    }>(
      `${c.base}/${c.userId}/media?fields=caption,timestamp,permalink,like_count,comments_count&limit=${LIMIT}&access_token=${encodeURIComponent(c.token)}`,
      {},
      "instagram media",
    );
    const posts: PulsePost[] = (body.data ?? []).map((m) => ({
      url: m.permalink ?? `https://www.instagram.com/p/${m.id}/`,
      text: m.caption ?? "",
      at: m.timestamp ?? "",
      likes: num(m.like_count),
      comments: num(m.comments_count),
      shares: null,
      views: null,
    }));
    return finish("instagram", "Instagram", posts);
  } catch (err) {
    return failed("instagram", "Instagram", err);
  }
}

/* ---------- Threads: list + per-post insights ---------- */

async function threads(c: { base: string; userId: string; token: string } | null): Promise<SitePulse> {
  if (!c) return notConnected("threads", "Threads");
  try {
    const body = await getJson<{ data?: Array<{ id: string; text?: string; timestamp?: string; permalink?: string }> }>(
      `${c.base}/${c.userId}/threads?fields=id,text,timestamp,permalink&limit=${LIMIT}&access_token=${encodeURIComponent(c.token)}`,
      {},
      "threads list",
    );
    const list = body.data ?? [];
    let insightsError: string | null = null;
    const posts: PulsePost[] = await Promise.all(
      list.map(async (t) => {
        const post: PulsePost = {
          url: t.permalink ?? `https://www.threads.net/post/${t.id}`,
          text: t.text ?? "",
          at: t.timestamp ?? "",
          likes: null,
          comments: null,
          shares: null,
          views: null,
        };
        try {
          const ins = await getJson<{ data?: Array<{ name: string; values?: Array<{ value?: number }> }> }>(
            `${c.base}/${t.id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${encodeURIComponent(c.token)}`,
            {},
            "threads insights",
          );
          const val = (name: string) => num(ins.data?.find((d) => d.name === name)?.values?.[0]?.value);
          post.views = val("views");
          post.likes = val("likes");
          post.comments = val("replies");
          post.shares = (val("reposts") ?? 0) + (val("quotes") ?? 0);
        } catch (err) {
          insightsError ??= err instanceof Error ? err.message : String(err);
        }
        return post;
      }),
    );
    const out = finish("threads", "Threads", posts);
    if (insightsError && posts.every((p) => p.likes == null)) out.error = `Posts listed, counts refused: ${insightsError}`;
    return out;
  } catch (err) {
    return failed("threads", "Threads", err);
  }
}

/* ---------- TikTok ---------- */

async function tiktok(): Promise<SitePulse> {
  const token = await tiktokAccessToken().catch(() => null);
  if (!token) return notConnected("tiktok", "TikTok");
  try {
    const base = process.env.TIKTOK_API_BASE ?? "https://open.tiktokapis.com";
    const body = await getJson<{
      data?: { videos?: Array<{ id: string; title?: string; create_time?: number; share_url?: string; like_count?: number; comment_count?: number; share_count?: number; view_count?: number }> };
      error?: { code?: string; message?: string };
    }>(
      `${base}/v2/video/list/?fields=id,title,create_time,share_url,like_count,comment_count,share_count,view_count`,
      { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ max_count: 20 }) },
      "tiktok video list",
    );
    if (body.error?.code && body.error.code !== "ok") throw new Error(`tiktok: ${body.error.code} ${body.error.message ?? ""}`);
    const posts: PulsePost[] = (body.data?.videos ?? []).map((v) => ({
      url: v.share_url ?? `https://www.tiktok.com/video/${v.id}`,
      text: v.title ?? "",
      at: v.create_time ? new Date(v.create_time * 1000).toISOString() : "",
      likes: num(v.like_count),
      comments: num(v.comment_count),
      shares: num(v.share_count),
      views: num(v.view_count),
    }));
    return finish("tiktok", "TikTok", posts);
  } catch (err) {
    return failed("tiktok", "TikTok", err);
  }
}

/** Every site's recent posts with their counts. Never throws. */
export async function socialPulse(): Promise<SitePulse[]> {
  const meta = await metaReadCreds().catch(() => ({ facebook: null, instagram: null, threads: null }));
  return Promise.all([bluesky(), x(), facebook(meta.facebook), instagram(meta.instagram), threads(meta.threads), tiktok()]);
}
