import "server-only";
import { db } from "@/lib/db";
import { socialPulse, type SitePulse } from "./socialPulse.ts";
import { autoReplyOn, commentsForPosts, orphanComments, countNew, type SocialComment } from "./socialInbox.ts";
import { postKey, SITE_ORDER, tally, type PostTotals, type StoredPost } from "@/lib/socialPosts";

/**
 * Social posts (Chris 09-28: "upgrade the pulse section for general post
 * management ... keep it all in one place ... small as possible"): one
 * table of every post the autopilot made with its counts and its comments.
 *
 * The page reads ONLY the database. Platforms are read by
 * refreshSocialPosts(): the inbox cron calls it an hour after each slot
 * (three reads a day, six sites) and the Refresh button calls it on
 * demand. Counts are upserted per (site, post id), so a post keeps its
 * row forever and the list grows as the autopilot posts — the platforms
 * only list their latest ~25, we keep them all.
 */

export interface SiteRead {
  site: string;
  label: string;
  connected: boolean;
  error: string | null;
  /** Posts the platform listed on this read. */
  posts: number;
  readAt: number;
}

export interface RefreshReport {
  at: number;
  sites: SiteRead[];
  /** Rows written (new or updated). */
  stored: number;
}

/** Read every site live and store what came back. Never throws — a failing site keeps its old rows and records the error. */
export async function refreshSocialPosts(now = Date.now()): Promise<RefreshReport> {
  const pulse: SitePulse[] = await socialPulse();
  let stored = 0;
  const sites: SiteRead[] = [];
  await db.transaction(async (tx) => {
    const up = tx.prepare(
      `INSERT INTO social_posts (site, post_id, url, text, at, likes, comments, shares, views, reactions, first_seen_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(site, post_id) DO UPDATE SET
         url = excluded.url,
         text = CASE WHEN excluded.text = '' THEN social_posts.text ELSE excluded.text END,
         at = CASE WHEN excluded.at = '' THEN social_posts.at ELSE excluded.at END,
         likes = COALESCE(excluded.likes, social_posts.likes),
         comments = COALESCE(excluded.comments, social_posts.comments),
         shares = COALESCE(excluded.shares, social_posts.shares),
         views = COALESCE(excluded.views, social_posts.views),
         reactions = COALESCE(excluded.reactions, social_posts.reactions),
         read_at = excluded.read_at`,
    );
    const mark = tx.prepare(
      `INSERT INTO social_pulse_reads (site, label, connected, error, posts, read_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(site) DO UPDATE SET label = excluded.label, connected = excluded.connected, error = excluded.error, posts = excluded.posts, read_at = excluded.read_at`,
    );
    for (const s of pulse) {
      for (const p of s.posts) {
        if (!p.id) continue;
        await up.run(s.site, p.id, p.url, p.text, p.at, p.likes, p.comments, p.shares, p.views, p.reactions && Object.keys(p.reactions).length ? JSON.stringify(p.reactions) : null, now, now);
        stored++;
      }
      await mark.run(s.site, s.label, s.connected ? 1 : 0, s.connected ? s.error : null, s.posts.length, now);
      sites.push({ site: s.site, label: s.label, connected: s.connected, error: s.connected ? s.error : null, posts: s.posts.length, readAt: now });
    }
  });
  return { at: now, sites, stored };
}

export interface PostsQuery {
  /** One site, or every site. */
  site?: string | null;
  /** Only posts with a comment waiting on Chris. */
  waiting?: boolean;
  /** Page on: posts strictly older than this ISO timestamp. */
  before?: string | null;
  limit?: number;
}

export interface PostsPage {
  posts: StoredPost[];
  /** Every comment we hold on the posts in this page. */
  comments: SocialComment[];
  /** Waiting comments whose post is not stored (mentions, older posts). First page only. */
  orphans: SocialComment[];
  sites: SiteRead[];
  /** Over every stored post (not just this page), for the selected site or all. */
  totals: PostTotals;
  /** Stored posts per site, for the filter chips. */
  perSite: Record<string, number>;
  /** Comments waiting on Chris, everywhere. */
  waiting: number;
  hasMore: boolean;
  /** Newest read across sites (ms), or null before the first refresh. */
  readAt: number | null;
  /** The robot sends its own replies (settings social_auto_reply, on by default). */
  autoReply: boolean;
}

function rowToPost(r: Record<string, unknown>): StoredPost {
  let reactions: Record<string, number> | null = null;
  try {
    reactions = r.reactions ? (JSON.parse(String(r.reactions)) as Record<string, number>) : null;
  } catch {
    /* keep null */
  }
  const n = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    site: String(r.site),
    postId: String(r.post_id),
    url: String(r.url),
    text: String(r.text ?? ""),
    at: String(r.at ?? ""),
    likes: n(r.likes),
    comments: n(r.comments),
    shares: n(r.shares),
    views: n(r.views),
    reactions,
    readAt: Number(r.read_at),
    waiting: Number(r.waiting ?? 0),
    held: Number(r.held ?? 0),
  };
}

/** One page of stored posts with their comments, plus the header numbers. Database only. */
export async function listSocialPosts(q: PostsQuery = {}): Promise<PostsPage> {
  const limit = Math.max(1, Math.min(q.limit ?? 40, 100));
  const where: string[] = [];
  const args: string[] = [];
  if (q.site) {
    where.push("p.site = ?");
    args.push(q.site);
  }
  if (q.before) {
    where.push("p.at < ?");
    args.push(q.before);
  }
  if (q.waiting) where.push("EXISTS (SELECT 1 FROM social_comments c WHERE c.site = p.site AND c.post_id = p.post_id AND c.status = 'new')");
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = (await db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM social_comments c WHERE c.site = p.site AND c.post_id = p.post_id AND c.status = 'new') AS waiting,
         (SELECT COUNT(*) FROM social_comments c WHERE c.site = p.site AND c.post_id = p.post_id) AS held
       FROM social_posts p ${filter} ORDER BY p.at DESC LIMIT ?`,
    )
    .all(...args, limit + 1)) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const posts = rows.slice(0, limit).map(rowToPost);
  const siteArgs = q.site ? [q.site] : [];
  const [comments, orphans, reads, sums, perSiteRows, waiting, autoReply] = await Promise.all([
    commentsForPosts(posts.filter((p) => p.held > 0).map((p) => postKey(p.site, p.postId))),
    q.before ? Promise.resolve([] as SocialComment[]) : orphanComments(),
    db.prepare("SELECT * FROM social_pulse_reads").all() as Promise<Record<string, unknown>[]>,
    db.prepare(`SELECT likes, comments, shares, views FROM social_posts ${q.site ? "WHERE site = ?" : ""}`).all(...siteArgs) as Promise<Record<string, unknown>[]>,
    db.prepare("SELECT site, COUNT(*) AS n FROM social_posts GROUP BY site").all() as Promise<Record<string, unknown>[]>,
    countNew(),
    autoReplyOn(),
  ]);
  const sites: SiteRead[] = reads
    .map((r) => ({
      site: String(r.site),
      label: String(r.label),
      connected: Number(r.connected) === 1,
      error: r.error == null ? null : String(r.error),
      posts: Number(r.posts),
      readAt: Number(r.read_at),
    }))
    .sort((a, b) => SITE_ORDER.indexOf(a.site) - SITE_ORDER.indexOf(b.site));
  const perSite: Record<string, number> = {};
  for (const r of perSiteRows) perSite[String(r.site)] = Number(r.n);
  const n = (v: unknown): number | null => (v == null ? null : Number(v));
  const totals = tally(sums.map((r) => ({ likes: n(r.likes), comments: n(r.comments), shares: n(r.shares), views: n(r.views) })));
  const readAt = sites.reduce<number | null>((acc, s) => (acc == null || s.readAt > acc ? s.readAt : acc), null);
  return { posts, comments, orphans, sites, totals, perSite, waiting, hasMore, readAt, autoReply };
}
