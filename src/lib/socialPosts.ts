/**
 * Pure helpers for the social posts page (/admin/social/posts), shared by
 * the server list and the client component. No DB, no fetch — tested in
 * scripts/test-social-posts.mjs.
 */

export const SITE_LABEL: Record<string, string> = {
  bluesky: "Bluesky",
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
  pinterest: "Pinterest",
};

export const SITE_ORDER = ["bluesky", "x", "facebook", "instagram", "threads", "tiktok", "pinterest"];

export function siteLabel(site: string): string {
  return SITE_LABEL[site] ?? (site ? site.charAt(0).toUpperCase() + site.slice(1) : "");
}

/** One stored post with its counts as last read, plus how many comments sit under it. */
export interface StoredPost {
  site: string;
  postId: string;
  url: string;
  text: string;
  /** ISO timestamp of the post. */
  at: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  /** Facebook reaction faces. */
  reactions: Record<string, number> | null;
  /** When the counts were last read from the platform (ms). */
  readAt: number;
  /** Comments in social_comments still waiting on Chris. */
  waiting: number;
  /** Every comment we hold for this post, any status. */
  held: number;
}

export interface PostTotals {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  /** null when no site reports views. */
  views: number | null;
}

/** The key social_comments rows are matched on. */
export function postKey(site: string, postId: string): string {
  return `${site}:${postId}`;
}

/** Sum the counts of a list of posts; views stay null until one post has them. */
export function tally(posts: Array<Pick<StoredPost, "likes" | "comments" | "shares" | "views">>): PostTotals {
  const out: PostTotals = { posts: posts.length, likes: 0, comments: 0, shares: 0, views: null };
  for (const p of posts) {
    out.likes += p.likes ?? 0;
    out.comments += p.comments ?? 0;
    out.shares += p.shares ?? 0;
    if (p.views != null) out.views = (out.views ?? 0) + p.views;
  }
  return out;
}

/** Group comments under their post key, newest first inside each group (input order kept). */
export function groupByPost<T extends { site: string; postId: string }>(comments: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const c of comments) {
    const k = postKey(c.site, c.postId);
    const list = out.get(k);
    if (list) list.push(c);
    else out.set(k, [c]);
  }
  return out;
}

/** Exact number with thousands separators; a dash when the platform gave nothing. */
export function count(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("en-US");
}

/** "Sep 28, 1:05 PM ET" in Eastern, the autopilot's clock. */
export function whenET(iso: string | number): string {
  if (!iso) return "";
  // iPhone Safari can't parse a "+0000" offset; "+00:00" it can.
  const d = new Date(typeof iso === "string" ? iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
}

/** One-line preview of a post's words. */
export function oneLine(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
