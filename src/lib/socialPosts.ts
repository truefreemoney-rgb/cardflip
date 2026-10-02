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

/**
 * Kind and slot tags (10-02, the daily optimization loop). The platforms
 * hand back a post's words and counts, not what the autopilot posted it as,
 * so each stored post is tagged once: from the publisher's own log when the
 * post is in it (social_post_log), else from its words and its Eastern hour
 * (TikTok is posted by hand; rows from before the log shipped).
 */
export type PostKindTag = "set" | "movers" | "games" | "dips" | "card";
export type SlotTag = "morning" | "midday" | "evening";

/** One social_post_log row: what the publisher sent where. */
export interface PostLogRow {
  site: string;
  /** What the site's post() returned. */
  url: string;
  /** Eastern day. */
  day: string;
  slot: SlotTag;
  kind: PostKindTag;
}

/** The kind a caption was written for, read off its opening words; null when it is none of the autopilot's formats. */
export function kindOfCaption(text: string): PostKindTag | null {
  const s = text.slice(0, 90).toLowerCase();
  if (s.includes("most valuable")) return "set";
  if (s.includes("price gains")) return "movers";
  if (s.includes("biggest price jump")) return "games";
  if (s.includes("card of the day")) return "card";
  if (s.includes("drop") || s.includes("fell") || s.includes("down")) return "dips";
  return null;
}

/** Eastern day (YYYY-MM-DD) and hour of a post's timestamp; null when it does not parse. */
export function easternOf(iso: string | number): { day: string; hour: number } | null {
  const d = new Date(typeof iso === "string" ? iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/** The slot an Eastern hour falls in: before 11am morning, before 5pm midday, else evening. */
export function slotOfHour(hour: number): SlotTag {
  return hour < 11 ? "morning" : hour < 17 ? "midday" : "evening";
}

/** True when a logged url is this stored post: the same link, or one ending in the platform's post id (X and Facebook list a different link than they return). */
export function sameLogged(post: { url: string; postId: string }, loggedUrl: string): boolean {
  return loggedUrl === post.url || (post.postId !== "" && loggedUrl.endsWith(`/${post.postId}`));
}

/**
 * The kind and slot one stored post went out as. `log` = the publisher's
 * rows; `videos` = the TikTok videos registered per slot and day (their
 * kind), since those are posted by hand and never logged. kind null = not
 * one of ours (a hand-written post), and then the slot is null too.
 */
export function tagPost(
  post: { site: string; postId: string; url: string; text: string; at: string },
  log: PostLogRow[],
  videos: Array<{ day: string; slot: SlotTag; kind: string }> = [],
): { kind: PostKindTag | null; slot: SlotTag | null } {
  const logged = log.find((l) => l.site === post.site && sameLogged(post, l.url));
  if (logged) return { kind: logged.kind, slot: logged.slot };
  const kind = kindOfCaption(post.text);
  if (!kind) return { kind: null, slot: null };
  const when = easternOf(post.at);
  if (!when) return { kind, slot: null };
  const planned =
    post.site === "tiktok"
      ? videos.find((v) => v.day === when.day && v.kind === kind)?.slot
      : log.find((l) => l.site === post.site && l.day === when.day && l.kind === kind)?.slot;
  return { kind, slot: planned ?? slotOfHour(when.hour) };
}

/** One-line preview of a post's words. */
export function oneLine(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
