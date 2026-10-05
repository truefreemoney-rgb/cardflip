import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import {
  classifyComment,
  DAILY_REPLY_CAP,
  fitReply,
  isOwnComment,
  isStale,
  PER_AUTHOR_DAILY_CAP,
  PER_THREAD_CAP,
  replyPlan,
  promisesFollowUp,
  replyProblem,
  type CommentKind,
} from "@/lib/socialModeration";
import { getSetting } from "@/lib/server/settings";
import { metaReadCreds } from "./sites/meta.ts";
import { xSignedGet, xSignedJson } from "./sites/x.ts";
import { blueskyCall, blueskyGet, blueskySession } from "./sites/bluesky.ts";
import { BoardConflictError, COMPLETED_TITLE, isCompletedSection, loadBoard, saveBoard } from "@/lib/server/board";
import { HELP_MODEL } from "@/lib/server/helpChat";

/**
 * Social inbox (Chris 09-28: "you should manage everything and look out for
 * spam"): an hour after each autopilot slot (vercel.json → /api/cron/
 * social-inbox) every site's comments and replies on our posts are read,
 * classified (lib/socialModeration.ts), and stored in social_comments.
 * Spam is hidden on sight where the platform allows (Facebook, Instagram,
 * Threads hide; X hides the reply) and only flagged on Bluesky (no hide
 * there). Who gets answered is lib/socialModeration.ts replyPlan (Chris
 * 09-28: "you should be able to manage and submit yourself ... only when
 * necessary and occasional fun/playful engagement"): questions and
 * anything naming CardFlip get a Haiku reply SENT by the sweep; praise
 * about one in four; plain remarks nothing; heated ones (refund, scam,
 * fake) wait for Chris with no draft. The switch is AUTO_REPLY_KEY (off =
 * drafts wait for Send). A reply that fails to send stays in the queue
 * with the reason. One Completed line on the board per sweep that found
 * something. TikTok is not read (comment.list scope + audit).
 */

export type CommentStatus = "new" | "hidden" | "replied" | "dismissed";

export interface SocialComment {
  id: string;
  site: string;
  commentId: string;
  postId: string;
  postUrl: string;
  postText: string;
  author: string;
  authorId: string | null;
  text: string;
  at: string;
  kind: CommentKind;
  status: CommentStatus;
  draft: string | null;
  replyText: string | null;
  seenAt: number;
  actedAt: number | null;
  meta: Record<string, unknown>;
}

interface Found {
  site: string;
  commentId: string;
  postId: string;
  postUrl: string;
  postText: string;
  author: string;
  authorId: string | null;
  text: string;
  at: string;
  meta?: Record<string, unknown>;
}

export interface SweepSite {
  site: string;
  label: string;
  connected: boolean;
  error: string | null;
  /** Comments seen on this sweep (new + already known). */
  seen: number;
  /** New rows written this sweep. */
  added: number;
  hidden: number;
  questions: number;
  /** Replies the robot sent itself this sweep. */
  replied: number;
  /** Comments parked for Chris (heated, capped, failed the pre-send check). */
  held: number;
  /** Repeat spammers blocked on the platform. */
  blocked: number;
}

export interface SweepReport {
  at: number;
  sites: SweepSite[];
  added: number;
  hidden: number;
  questions: number;
  replied: number;
  held: number;
  blocked: number;
}

/** Settings key for the auto-reply switch on /admin/social/posts. On unless set to "0". */
export const AUTO_REPLY_KEY = "social_auto_reply";
export async function autoReplyOn(): Promise<boolean> {
  return (await getSetting(AUTO_REPLY_KEY)) !== "0";
}

const SITE_LABEL: Record<string, string> = { bluesky: "Bluesky", x: "X", facebook: "Facebook", instagram: "Instagram", threads: "Threads" };
const LIMIT = 25;
const TIMEOUT_MS = 15_000;

async function getJson<T>(url: string, init: RequestInit = {}, step = url): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${step} ${res.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/* ---------- readers ---------- */

async function readBluesky(): Promise<Found[]> {
  const session = await blueskySession();
  if (!session) throw new Error("not connected");
  const handle = process.env.BLUESKY_HANDLE?.trim() ?? "";
  type Notif = {
    uri: string;
    cid: string;
    author: { did: string; handle: string; displayName?: string };
    reason: string;
    reasonSubject?: string;
    record?: { text?: string; createdAt?: string; reply?: { root?: { uri: string; cid: string }; parent?: { uri: string; cid: string } } };
  };
  const body = await blueskyGet<{ notifications?: Notif[] }>("app.bsky.notification.listNotifications", { limit: "50" }, session);
  const wanted = (body.notifications ?? []).filter((n) => (n.reason === "reply" || n.reason === "mention" || n.reason === "quote") && n.author.did !== session.did);
  // Our post's text for context: one batched getPosts on the subjects.
  const subjects = [...new Set(wanted.map((n) => n.reasonSubject).filter((u): u is string => Boolean(u)))].slice(0, 25);
  const postText = new Map<string, string>();
  if (subjects.length) {
    try {
      const posts = await blueskyGet<{ posts?: Array<{ uri: string; record?: { text?: string } }> }>("app.bsky.feed.getPosts", { uris: subjects.join(",") }, session);
      for (const p of posts.posts ?? []) postText.set(p.uri, p.record?.text ?? "");
    } catch {
      /* context only */
    }
  }
  const webUrl = (uri: string) => {
    const m = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
    return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : uri;
  };
  return wanted.map((n) => ({
    site: "bluesky",
    commentId: n.uri,
    postId: n.reasonSubject ?? n.uri,
    postUrl: n.reasonSubject ? webUrl(n.reasonSubject).replace(`/profile/${session.did}/`, `/profile/${handle}/`) : webUrl(n.uri),
    postText: n.reasonSubject ? (postText.get(n.reasonSubject) ?? "") : "",
    author: n.author.displayName ? `${n.author.displayName} (@${n.author.handle})` : `@${n.author.handle}`,
    authorId: n.author.did,
    text: n.record?.text ?? "",
    at: n.record?.createdAt ?? "",
    meta: { cid: n.cid, root: n.record?.reply?.root ?? { uri: n.uri, cid: n.cid }, reason: n.reason },
  }));
}

async function readX(): Promise<Found[]> {
  const meRes = await xSignedGet("/2/users/me", { "user.fields": "username" });
  if (!meRes) throw new Error("not connected");
  if (!meRes.ok) throw new Error(`x me ${meRes.status}: ${(await meRes.text()).slice(0, 200)}`);
  const me = (await meRes.json()) as { data?: { id: string; username?: string } };
  if (!me.data?.id) throw new Error("x me: no id");
  const handle = me.data.username ?? "cardflipio";
  const res = await xSignedGet(`/2/users/${me.data.id}/mentions`, {
    max_results: "50",
    "tweet.fields": "created_at,author_id,conversation_id,referenced_tweets,text",
    expansions: "author_id,referenced_tweets.id",
    "user.fields": "username,name",
  });
  if (!res) throw new Error("not connected");
  if (!res.ok) throw new Error(`x mentions ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    data?: Array<{ id: string; text?: string; created_at?: string; author_id?: string; conversation_id?: string; referenced_tweets?: Array<{ type: string; id: string }> }>;
    includes?: { users?: Array<{ id: string; username?: string; name?: string }>; tweets?: Array<{ id: string; text?: string }> };
  };
  const users = new Map((body.includes?.users ?? []).map((u) => [u.id, u]));
  const tweets = new Map((body.includes?.tweets ?? []).map((t) => [t.id, t.text ?? ""]));
  return (body.data ?? [])
    .filter((t) => t.author_id !== me.data?.id)
    .map((t) => {
      const parent = t.referenced_tweets?.find((r) => r.type === "replied_to")?.id ?? t.conversation_id ?? t.id;
      const u = users.get(t.author_id ?? "");
      return {
        site: "x",
        commentId: t.id,
        postId: parent,
        postUrl: `https://x.com/${handle}/status/${parent}`,
        postText: tweets.get(parent) ?? "",
        author: u ? `${u.name ?? ""} (@${u.username ?? ""})`.trim() : (t.author_id ?? "?"),
        authorId: t.author_id ?? null,
        text: t.text ?? "",
        at: t.created_at ?? "",
        meta: { conversationId: t.conversation_id },
      };
    });
}

async function readFacebook(c: { base: string; pageId: string; token: string }): Promise<Found[]> {
  const fields = `id,message,permalink_url,comments.limit(50).filter(stream){id,message,from,created_time,is_hidden,can_hide,parent}`;
  const body = await getJson<{
    data?: Array<{
      id: string;
      message?: string;
      permalink_url?: string;
      comments?: { data?: Array<{ id: string; message?: string; from?: { id: string; name?: string }; created_time?: string; is_hidden?: boolean; parent?: { id: string } }> };
    }>;
  }>(`${c.base}/${c.pageId}/published_posts?fields=${encodeURIComponent(fields)}&limit=${LIMIT}&access_token=${encodeURIComponent(c.token)}`, {}, "facebook posts");
  const out: Found[] = [];
  for (const p of body.data ?? []) {
    for (const cm of p.comments?.data ?? []) {
      if (isOwnComment(cm.from?.id, null, [c.pageId])) continue;
      out.push({
        site: "facebook",
        commentId: cm.id,
        postId: p.id,
        postUrl: p.permalink_url ?? `https://www.facebook.com/${p.id}`,
        postText: p.message ?? "",
        author: cm.from?.name ?? "Facebook user",
        authorId: cm.from?.id ?? null,
        text: cm.message ?? "",
        at: cm.created_time ?? "",
        meta: { hiddenOnSite: Boolean(cm.is_hidden) },
      });
    }
  }
  return out;
}

async function readInstagram(c: { base: string; userId: string; token: string }): Promise<Found[]> {
  const fields = `id,caption,permalink,comments.limit(50){id,text,username,timestamp,hidden,from}`;
  const body = await getJson<{
    data?: Array<{
      id: string;
      caption?: string;
      permalink?: string;
      comments?: { data?: Array<{ id: string; text?: string; username?: string; timestamp?: string; hidden?: boolean; from?: { id?: string; username?: string } }> };
    }>;
  }>(`${c.base}/${c.userId}/media?fields=${encodeURIComponent(fields)}&limit=${LIMIT}&access_token=${encodeURIComponent(c.token)}`, {}, "instagram media");
  const own = [c.userId, process.env.INSTAGRAM_HANDLE ?? "", "cardflipio"];
  const out: Found[] = [];
  for (const m of body.data ?? []) {
    for (const cm of m.comments?.data ?? []) {
      const handle = cm.username ?? cm.from?.username ?? "";
      if (isOwnComment(cm.from?.id, handle, own)) continue;
      out.push({
        site: "instagram",
        commentId: cm.id,
        postId: m.id,
        postUrl: m.permalink ?? `https://www.instagram.com/p/${m.id}/`,
        postText: m.caption ?? "",
        author: handle ? `@${handle}` : "Instagram user",
        authorId: cm.from?.id ?? handle ?? null,
        text: cm.text ?? "",
        at: cm.timestamp ?? "",
        meta: { hiddenOnSite: Boolean(cm.hidden) },
      });
    }
  }
  return out;
}

async function readThreads(c: { base: string; userId: string; token: string }): Promise<Found[]> {
  const list = await getJson<{ data?: Array<{ id: string; text?: string; permalink?: string }> }>(
    `${c.base}/${c.userId}/threads?fields=id,text,permalink&limit=${LIMIT}&access_token=${encodeURIComponent(c.token)}`,
    {},
    "threads list",
  );
  const out: Found[] = [];
  await Promise.all(
    (list.data ?? []).map(async (t) => {
      const replies = await getJson<{ data?: Array<{ id: string; text?: string; username?: string; timestamp?: string; hide_status?: string; is_reply_owned_by_me?: boolean }> }>(
        `${c.base}/${t.id}/replies?fields=id,text,username,timestamp,hide_status,is_reply_owned_by_me&access_token=${encodeURIComponent(c.token)}`,
        {},
        "threads replies",
      ).catch(() => ({ data: [] as Array<{ id: string; text?: string; username?: string; timestamp?: string; hide_status?: string; is_reply_owned_by_me?: boolean }> }));
      for (const r of replies.data ?? []) {
        if (r.is_reply_owned_by_me) continue;
        out.push({
          site: "threads",
          commentId: r.id,
          postId: t.id,
          postUrl: t.permalink ?? `https://www.threads.net/post/${t.id}`,
          postText: t.text ?? "",
          author: r.username ? `@${r.username}` : "Threads user",
          authorId: r.username ?? null,
          text: r.text ?? "",
          at: r.timestamp ?? "",
          meta: { hiddenOnSite: r.hide_status === "HIDDEN" },
        });
      }
    }),
  );
  return out;
}

/* ---------- actions on the platforms ---------- */

type MetaCreds = Awaited<ReturnType<typeof metaReadCreds>>;

async function hideOnSite(c: SocialComment, meta: MetaCreds): Promise<void> {
  switch (c.site) {
    case "facebook": {
      if (!meta.facebook) throw new Error("Facebook not connected");
      await getJson(`${meta.facebook.base}/${c.commentId}?is_hidden=true&access_token=${encodeURIComponent(meta.facebook.token)}`, { method: "POST" }, "facebook hide");
      return;
    }
    case "instagram": {
      if (!meta.instagram) throw new Error("Instagram not connected");
      await getJson(`${meta.instagram.base}/${c.commentId}?hide=true&access_token=${encodeURIComponent(meta.instagram.token)}`, { method: "POST" }, "instagram hide");
      return;
    }
    case "threads": {
      if (!meta.threads) throw new Error("Threads not connected");
      await getJson(`${meta.threads.base}/${c.commentId}/manage_reply?hide=true&access_token=${encodeURIComponent(meta.threads.token)}`, { method: "POST" }, "threads hide");
      return;
    }
    case "x": {
      const res = await xSignedJson("PUT", `/2/tweets/${c.commentId}/hidden`, { hidden: true });
      if (!res) throw new Error("X not connected");
      if (!res.ok) throw new Error(`x hide ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    default:
      throw new Error(`${SITE_LABEL[c.site] ?? c.site} has no hide; dismiss it instead`);
  }
}

async function replyOnSite(c: SocialComment, text: string, meta: MetaCreds): Promise<string | null> {
  switch (c.site) {
    case "bluesky": {
      const session = await blueskySession();
      if (!session) throw new Error("Bluesky not connected");
      const root = (c.meta.root as { uri: string; cid: string } | undefined) ?? { uri: c.commentId, cid: String(c.meta.cid ?? "") };
      const rec = await blueskyCall<{ uri: string }>(
        "com.atproto.repo.createRecord",
        {
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), reply: { root, parent: { uri: c.commentId, cid: String(c.meta.cid ?? "") } } },
        },
        session,
      );
      return rec.uri;
    }
    case "x": {
      const res = await xSignedJson("POST", "/2/tweets", { text, reply: { in_reply_to_tweet_id: c.commentId } });
      if (!res) throw new Error("X not connected");
      if (!res.ok) throw new Error(`x reply ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { data?: { id?: string } };
      return j.data?.id ?? null;
    }
    case "facebook": {
      if (!meta.facebook) throw new Error("Facebook not connected");
      const j = await getJson<{ id?: string }>(
        `${meta.facebook.base}/${c.commentId}/comments?message=${encodeURIComponent(text)}&access_token=${encodeURIComponent(meta.facebook.token)}`,
        { method: "POST" },
        "facebook reply",
      );
      return j.id ?? null;
    }
    case "instagram": {
      if (!meta.instagram) throw new Error("Instagram not connected");
      const j = await getJson<{ id?: string }>(
        `${meta.instagram.base}/${c.commentId}/replies?message=${encodeURIComponent(text)}&access_token=${encodeURIComponent(meta.instagram.token)}`,
        { method: "POST" },
        "instagram reply",
      );
      return j.id ?? null;
    }
    case "threads": {
      if (!meta.threads) throw new Error("Threads not connected");
      const made = await getJson<{ id?: string }>(
        `${meta.threads.base}/${meta.threads.userId}/threads?media_type=TEXT&text=${encodeURIComponent(text)}&reply_to_id=${encodeURIComponent(c.commentId)}&access_token=${encodeURIComponent(meta.threads.token)}`,
        { method: "POST" },
        "threads reply create",
      );
      if (!made.id) throw new Error("threads reply: no creation id");
      const pub = await getJson<{ id?: string }>(
        `${meta.threads.base}/${meta.threads.userId}/threads_publish?creation_id=${encodeURIComponent(made.id)}&access_token=${encodeURIComponent(meta.threads.token)}`,
        { method: "POST" },
        "threads reply publish",
      );
      return pub.id ?? null;
    }
    default:
      throw new Error(`${SITE_LABEL[c.site] ?? c.site}: replies not supported`);
  }
}

/** Remove a reply the robot (or Chris) posted. Bluesky, X, Facebook, Instagram and Threads all delete their own record by id. */
async function deleteReplyOnSite(c: SocialComment, meta: MetaCreds): Promise<void> {
  const replyId = typeof c.meta.replyId === "string" ? c.meta.replyId : null;
  if (!replyId) throw new Error("No reply id stored for this comment");
  switch (c.site) {
    case "bluesky": {
      const session = await blueskySession();
      if (!session) throw new Error("Bluesky not connected");
      const rkey = replyId.split("/").pop();
      if (!rkey) throw new Error("bluesky: bad reply uri");
      await blueskyCall("com.atproto.repo.deleteRecord", { repo: session.did, collection: "app.bsky.feed.post", rkey }, session);
      return;
    }
    case "x": {
      const res = await xSignedJson("DELETE", `/2/tweets/${replyId}`, {});
      if (!res) throw new Error("X not connected");
      if (!res.ok) throw new Error(`x delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    case "facebook":
    case "instagram":
    case "threads": {
      const c2 = meta[c.site];
      if (!c2) throw new Error(`${SITE_LABEL[c.site]} not connected`);
      await getJson(`${c2.base}/${replyId}?access_token=${encodeURIComponent(c2.token)}`, { method: "DELETE" }, `${c.site} delete reply`);
      return;
    }
    default:
      throw new Error(`${SITE_LABEL[c.site] ?? c.site}: delete not supported`);
  }
}

/** Block the comment's author where a robot may: Bluesky (block record), X (blocking), Facebook (page block list). */
async function blockOnSite(c: SocialComment, meta: MetaCreds): Promise<void> {
  if (!c.authorId) throw new Error("No author id");
  switch (c.site) {
    case "bluesky": {
      const session = await blueskySession();
      if (!session) throw new Error("Bluesky not connected");
      await blueskyCall(
        "com.atproto.repo.createRecord",
        { repo: session.did, collection: "app.bsky.graph.block", record: { $type: "app.bsky.graph.block", subject: c.authorId, createdAt: new Date().toISOString() } },
        session,
      );
      return;
    }
    case "x": {
      const meRes = await xSignedGet("/2/users/me", {});
      if (!meRes) throw new Error("X not connected");
      if (!meRes.ok) throw new Error(`x me ${meRes.status}`);
      const me = (await meRes.json()) as { data?: { id?: string } };
      if (!me.data?.id) throw new Error("x me: no id");
      const res = await xSignedJson("POST", `/2/users/${me.data.id}/blocking`, { target_user_id: c.authorId });
      if (!res) throw new Error("X not connected");
      if (!res.ok) throw new Error(`x block ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    case "facebook": {
      if (!meta.facebook) throw new Error("Facebook not connected");
      await getJson(`${meta.facebook.base}/${meta.facebook.pageId}/blocked?user=${encodeURIComponent(c.authorId)}&access_token=${encodeURIComponent(meta.facebook.token)}`, { method: "POST" }, "facebook block");
      return;
    }
    default:
      throw new Error(`${SITE_LABEL[c.site] ?? c.site} has no block for pages; hiding is the most it allows`);
  }
}

/**
 * Why the robot may not answer this one right now, or null. Ten a day
 * across every site, one per person per day, two per person under one
 * post; beyond that the comment waits for Chris.
 */
async function replyCapReason(site: string, postId: string, authorId: string | null, now: number): Promise<string | null> {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const auto = "status = 'replied' AND meta LIKE '%\"auto\":true%'";
  const today = (await db.prepare(`SELECT COUNT(*) AS n FROM social_comments WHERE ${auto} AND acted_at >= ?`).get(dayAgo)) as { n: number } | undefined;
  if (Number(today?.n ?? 0) >= DAILY_REPLY_CAP) return `the robot already sent ${DAILY_REPLY_CAP} replies today`;
  if (!authorId) return null;
  const person = (await db.prepare(`SELECT COUNT(*) AS n FROM social_comments WHERE ${auto} AND site = ? AND author_id = ? AND acted_at >= ?`).get(site, authorId, dayAgo)) as { n: number } | undefined;
  if (Number(person?.n ?? 0) >= PER_AUTHOR_DAILY_CAP) return "the robot already answered this person today";
  const thread = (await db.prepare(`SELECT COUNT(*) AS n FROM social_comments WHERE ${auto} AND site = ? AND post_id = ? AND author_id = ?`).get(site, postId, authorId)) as { n: number } | undefined;
  if (Number(thread?.n ?? 0) >= PER_THREAD_CAP) return "a back-and-forth; the robot stops after two";
  return null;
}

/* ---------- drafting ---------- */

let client: Anthropic | null = null;
const DRAFT_SYSTEM = `You write short replies for CardFlip's social accounts (cardflip.io: scan a trading card with your phone, see what it is worth, sell it on eBay in one tap). You are answering a comment on one of our posts. Rules: one or two sentences, friendly and plain, no hashtags, no emoji unless the comment used them, no prices or claims that are not in the post text, never promise shipping, refunds, or deals, never argue. If the comment asks how to use CardFlip, say it is at cardflip.io and the first scans are free. If the comment is just praise, one short line back; dry and a little playful is welcome, no exclamation marks, no hype. If the comment names CardFlip without asking anything, answer what they seem to want in one line. If you cannot answer the question yourself in this reply, from the post or plain trading-card knowledge, output exactly SKIP: never say you will check, look into it, get back to them or follow up, and never send them to a page instead of an answer. Either answer it or output SKIP. Output only the reply text.`;

/** The model's way of saying it has no answer: nothing is sent and nothing waits for Chris. */
const NO_ANSWER = "SKIP";

/** The reply text; "" when the robot has no real answer (say nothing); null when drafting failed. */
export async function draftReply(c: { site: string; postText: string; text: string; kind: CommentKind }): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    client ??= new Anthropic();
    const res = await client.messages.create({
      model: HELP_MODEL,
      max_tokens: 200,
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: `Site: ${SITE_LABEL[c.site] ?? c.site} (max ${fitReply(c.site, "x".repeat(2000)).length} characters)\nOur post:\n${c.postText.slice(0, 600)}\n\nTheir comment (${c.kind}):\n${c.text.slice(0, 600)}` }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    // No answer, or one that defers anyway: "" = nothing to say (Chris 10-04: "either answer the question or dont").
    // null stays "the draft failed", which still waits for Chris.
    if (!text || text.replace(/[^A-Z]/g, "") === NO_ANSWER || promisesFollowUp(text)) return "";
    return fitReply(c.site, text);
  } catch (err) {
    console.warn("social inbox: draft failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/* ---------- storage ---------- */

function rowToComment(r: Record<string, unknown>): SocialComment {
  let meta: Record<string, unknown> = {};
  try {
    meta = r.meta ? (JSON.parse(String(r.meta)) as Record<string, unknown>) : {};
  } catch {
    /* keep {} */
  }
  return {
    id: String(r.id),
    site: String(r.site),
    commentId: String(r.comment_id),
    postId: String(r.post_id),
    postUrl: String(r.post_url),
    postText: String(r.post_text ?? ""),
    author: String(r.author),
    authorId: r.author_id == null ? null : String(r.author_id),
    text: String(r.text),
    at: String(r.at),
    kind: String(r.kind) as CommentKind,
    status: String(r.status) as CommentStatus,
    draft: r.draft == null ? null : String(r.draft),
    replyText: r.reply_text == null ? null : String(r.reply_text),
    seenAt: Number(r.seen_at),
    actedAt: r.acted_at == null ? null : Number(r.acted_at),
    meta,
  };
}

export async function listComments(status: CommentStatus | "handled", limit = 100): Promise<SocialComment[]> {
  const rows =
    status === "handled"
      ? await db.prepare("SELECT * FROM social_comments WHERE status <> 'new' ORDER BY COALESCE(acted_at, seen_at) DESC LIMIT ?").all(limit)
      : await db.prepare("SELECT * FROM social_comments WHERE status = ? ORDER BY at DESC LIMIT ?").all(status, limit);
  return rows.map(rowToComment);
}

/**
 * Every comment (any status) on the given posts, newest first — the posts
 * page shows them under each post. keys are "<site>:<post id>".
 */
export async function commentsForPosts(keys: string[]): Promise<SocialComment[]> {
  if (keys.length === 0) return [];
  const rows = (await db
    .prepare(`SELECT * FROM social_comments WHERE (site || ':' || post_id) IN (${keys.map(() => "?").join(",")}) ORDER BY at DESC`)
    .all(...keys)) as Record<string, unknown>[];
  return rows.map(rowToComment);
}

/** Waiting comments whose post is not in social_posts yet (a mention, or a post older than the platform lists). */
export async function orphanComments(limit = 50): Promise<SocialComment[]> {
  const rows = (await db
    .prepare(
      "SELECT c.* FROM social_comments c WHERE c.status = 'new' AND NOT EXISTS (SELECT 1 FROM social_posts p WHERE p.site = c.site AND p.post_id = c.post_id) ORDER BY c.at DESC LIMIT ?",
    )
    .all(limit)) as Record<string, unknown>[];
  return rows.map(rowToComment);
}

export async function getComment(id: string): Promise<SocialComment | null> {
  const r = await db.prepare("SELECT * FROM social_comments WHERE id = ?").get(id);
  return r ? rowToComment(r) : null;
}

export async function countNew(): Promise<number> {
  const r = (await db.prepare("SELECT COUNT(*) AS n FROM social_comments WHERE status = 'new'").get()) as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/** Spam by the same author before this one — the second offence is the block signal (flagged in the digest; blocking is a later step). */
async function priorSpam(site: string, authorId: string | null): Promise<number> {
  if (!authorId) return 0;
  const r = (await db.prepare("SELECT COUNT(*) AS n FROM social_comments WHERE site = ? AND author_id = ? AND kind = 'spam'").get(site, authorId)) as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/* ---------- the sweep ---------- */

export async function sweepSocialInbox(now = Date.now()): Promise<SweepReport> {
  const [meta, auto] = await Promise.all([metaReadCreds().catch(() => ({ facebook: null, instagram: null, threads: null })), autoReplyOn()]);
  const readers: Array<{ site: string; connected: boolean; read: () => Promise<Found[]> }> = [
    { site: "bluesky", connected: Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD), read: readBluesky },
    { site: "x", connected: Boolean(process.env.X_API_KEY), read: readX },
    { site: "facebook", connected: Boolean(meta.facebook), read: () => readFacebook(meta.facebook!) },
    { site: "instagram", connected: Boolean(meta.instagram), read: () => readInstagram(meta.instagram!) },
    { site: "threads", connected: Boolean(meta.threads), read: () => readThreads(meta.threads!) },
  ];
  const sites: SweepSite[] = await Promise.all(
    readers.map(async ({ site, connected, read }): Promise<SweepSite> => {
      const out: SweepSite = { site, label: SITE_LABEL[site] ?? site, connected, error: null, seen: 0, added: 0, hidden: 0, questions: 0, replied: 0, held: 0, blocked: 0 };
      if (!connected) return out;
      let found: Found[];
      try {
        found = await read();
      } catch (err) {
        out.error = err instanceof Error ? err.message : String(err);
        return out;
      }
      out.seen = found.length;
      for (const f of found) {
        const id = `${f.site}:${f.commentId}`;
        const known = await db.prepare("SELECT 1 AS one FROM social_comments WHERE id = ?").get(id);
        if (known) continue;
        const kind = classifyComment(f.text);
        let status: CommentStatus = "new";
        let draft: string | null = null;
        const row: SocialComment = {
          id,
          site: f.site,
          commentId: f.commentId,
          postId: f.postId,
          postUrl: f.postUrl,
          postText: f.postText,
          author: f.author,
          authorId: f.authorId,
          text: f.text,
          at: f.at,
          kind,
          status,
          draft,
          replyText: null,
          seenAt: now,
          actedAt: null,
          meta: f.meta ?? {},
        };
        if (kind === "spam") {
          const repeat = await priorSpam(f.site, f.authorId);
          row.meta.repeatOffender = repeat >= 1;
          if (f.meta?.hiddenOnSite) {
            status = "hidden";
          } else {
            try {
              await hideOnSite(row, meta);
              status = "hidden";
              out.hidden++;
            } catch (err) {
              // Bluesky (no hide) and refused hides stay in the queue, flagged.
              row.meta.hideError = err instanceof Error ? err.message : String(err);
              status = "new";
            }
          }
          // Second spam from the same account: block it where the platform lets a robot do that.
          if (repeat >= 1 && f.authorId) {
            try {
              await blockOnSite(row, meta);
              row.meta.blocked = true;
              out.blocked++;
            } catch (err) {
              row.meta.blockError = err instanceof Error ? err.message : String(err);
            }
          }
        } else {
          if (kind === "question") out.questions++;
          const plan = replyPlan(kind, f.text, id);
          const hold = (why: string) => {
            row.meta.needsYou = true;
            row.meta.holdReason = why;
            out.held++;
          };
          if (plan === "hold") {
            // Heated or a dispute: shown to Chris with no draft, answered in his words.
            hold("heated or a dispute");
          } else if (plan === "reply" && isStale(f.at, now)) {
            // Older than two days: stored, never answered.
            row.meta.stale = true;
          } else if (plan === "reply") {
            const cap = auto ? await replyCapReason(f.site, f.postId, f.authorId, now) : null;
            draft = await draftReply({ site: f.site, postText: f.postText, text: f.text, kind });
            const problem = draft ? replyProblem(draft, f.postText, f.site) : "no draft";
            if (draft === "") {
              // The robot had no real answer: stored under its post, nothing said, nothing held (Chris 10-04).
              row.meta.noAnswer = true;
            } else if (cap) hold(cap);
            else if (auto && problem) hold(`the reply ${problem}`);
            else if (draft && auto) {
              try {
                const sentId = await replyOnSite(row, draft, meta);
                status = "replied";
                row.replyText = draft;
                row.meta.replyId = sentId;
                row.meta.auto = true;
                out.replied++;
              } catch (err) {
                // The draft stays in Chris's queue with the reason.
                row.meta.sendError = err instanceof Error ? err.message : String(err);
                hold("the send failed");
              }
            }
          }
          // plan === "skip": stored under its post, nothing said.
        }
        await db
          .prepare(
            "INSERT OR IGNORE INTO social_comments (id, site, comment_id, post_id, post_url, post_text, author, author_id, text, at, kind, status, draft, reply_text, seen_at, acted_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(id, f.site, f.commentId, f.postId, f.postUrl, f.postText.slice(0, 2000), f.author, f.authorId, f.text.slice(0, 4000), f.at, kind, status, draft, row.replyText, now, status === "new" ? null : now, JSON.stringify(row.meta));
        out.added++;
      }
      return out;
    }),
  );
  const report: SweepReport = {
    at: now,
    sites,
    added: sites.reduce((a, s) => a + s.added, 0),
    hidden: sites.reduce((a, s) => a + s.hidden, 0),
    questions: sites.reduce((a, s) => a + s.questions, 0),
    replied: sites.reduce((a, s) => a + s.replied, 0),
    held: sites.reduce((a, s) => a + s.held, 0),
    blocked: sites.reduce((a, s) => a + s.blocked, 0),
  };
  await noteSweepOnBoard(report).catch(() => {});
  return report;
}

/* ---------- Chris's actions ---------- */

export type CommentAction = "reply" | "hide" | "dismiss" | "undo" | "block";

export async function actOnComment(id: string, action: CommentAction, text?: string): Promise<SocialComment> {
  const c = await getComment(id);
  if (!c) throw new Error("Comment not found");
  const now = Date.now();
  if (action === "undo") {
    // Take our reply down on the platform; the comment goes back to dismissed with the old text kept in meta.
    const meta = await metaReadCreds().catch(() => ({ facebook: null, instagram: null, threads: null }));
    await deleteReplyOnSite(c, meta);
    const { replyId: _gone, ...rest } = c.meta;
    void _gone;
    await db
      .prepare("UPDATE social_comments SET status = 'dismissed', reply_text = NULL, acted_at = ?, meta = ? WHERE id = ?")
      .run(now, JSON.stringify({ ...rest, undone: c.replyText, auto: false }), id);
  } else if (action === "block") {
    const meta = await metaReadCreds().catch(() => ({ facebook: null, instagram: null, threads: null }));
    await blockOnSite(c, meta);
    await db
      .prepare("UPDATE social_comments SET status = CASE WHEN status = 'new' THEN 'dismissed' ELSE status END, acted_at = COALESCE(acted_at, ?), meta = ? WHERE id = ?")
      .run(now, JSON.stringify({ ...c.meta, blocked: true }), id);
  } else if (action === "reply") {
    const body = fitReply(c.site, (text ?? c.draft ?? "").trim());
    if (!body) throw new Error("Reply text is empty");
    const meta = await metaReadCreds().catch(() => ({ facebook: null, instagram: null, threads: null }));
    const sentId = await replyOnSite(c, body, meta);
    await db.prepare("UPDATE social_comments SET status = 'replied', reply_text = ?, acted_at = ?, meta = ? WHERE id = ?").run(body, now, JSON.stringify({ ...c.meta, replyId: sentId }), id);
  } else if (action === "hide") {
    const meta = await metaReadCreds().catch(() => ({ facebook: null, instagram: null, threads: null }));
    await hideOnSite(c, meta);
    await db.prepare("UPDATE social_comments SET status = 'hidden', acted_at = ? WHERE id = ?").run(now, id);
  } else {
    await db.prepare("UPDATE social_comments SET status = 'dismissed', acted_at = ? WHERE id = ?").run(now, id);
  }
  return (await getComment(id))!;
}

/** Regenerate the draft for one comment (the Redraft button). */
export async function redraft(id: string): Promise<string | null> {
  const c = await getComment(id);
  if (!c) throw new Error("Comment not found");
  const draft = await draftReply({ site: c.site, postText: c.postText, text: c.text, kind: c.kind });
  if (draft) await db.prepare("UPDATE social_comments SET draft = ? WHERE id = ?").run(draft, id);
  return draft;
}

/* ---------- board line ---------- */

/** Start of the Eastern day that holds `now`, in ms. */
function easternDayStart(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", second: "numeric", hour12: false }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0) % 24;
  return now - ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 - (now % 1000);
}

/**
 * One board line per day (Chris 09-28: "do them all"): the day's totals
 * from the table, rewritten in place on every sweep, plus any site that
 * could not be read this time.
 */
async function noteSweepOnBoard(r: SweepReport): Promise<void> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(r.at));
  const start = easternDayStart(r.at);
  const n = async (where: string, ...args: (string | number)[]) =>
    Number(((await db.prepare(`SELECT COUNT(*) AS n FROM social_comments WHERE seen_at >= ? AND ${where}`).get(start, ...args)) as { n: number } | undefined)?.n ?? 0);
  const [seen, answered, hidden, held, blocked, waiting] = await Promise.all([
    n("1"),
    n("status = 'replied' AND meta LIKE '%\"auto\":true%'"),
    n("status = 'hidden'"),
    n("meta LIKE '%\"needsYou\":true%'"),
    n("meta LIKE '%\"blocked\":true%'"),
    countNew(),
  ]);
  const unread = r.sites.filter((s) => s.error).map((s) => `${s.label} not read (${s.error!.slice(0, 60)})`);
  if (seen === 0 && unread.length === 0) return;
  const prefix = `Social ${day} —`;
  const text = `${prefix} ${seen} comment${seen === 1 ? "" : "s"}: ${answered} answered, ${held} held for you, ${hidden} spam hidden, ${blocked} blocked${unread.length ? ` · ${unread.join(" · ")}` : ""}. ${waiting} waiting → /admin/social/posts`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { sections, updatedAt } = await loadBoard();
      let completed = sections.find(isCompletedSection);
      if (!completed) {
        completed = { id: randomUUID(), title: COMPLETED_TITLE, hint: "what got finished, newest first", items: [] };
        sections.push(completed);
      }
      const existing = completed.items.find((it) => it.text.startsWith(prefix));
      if (existing) existing.text = text;
      else completed.items.unshift({ id: randomUUID(), done: true, owner: "Claude", text, completedAt: r.at, from: "Claude — my queue (in order)" });
      await saveBoard(sections, updatedAt);
      return;
    } catch (err) {
      if (!(err instanceof BoardConflictError) || attempt === 1) {
        console.warn("social inbox: board note skipped", err instanceof Error ? err.message : err);
        return;
      }
    }
  }
}
