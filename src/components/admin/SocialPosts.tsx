"use client";

import { useState } from "react";
import type { SocialComment } from "@/lib/server/socialInbox";
import type { PostsPage } from "@/lib/server/socialPosts";
import { count, groupByPost, postKey, SITE_ORDER, siteLabel, whenET, type StoredPost } from "@/lib/socialPosts";
import SocialCommentCard, { HandledComment } from "./SocialCommentCard";

/**
 * /admin/social/posts — every post on every site, newest first, with its
 * counts and its comments in one list. Opens from the database only;
 * Refresh reads the platforms (counts + comments) and stores the result,
 * so casual opens cost nothing. Each row opens to its full words,
 * Facebook faces and the comments under it, waiting ones first with the
 * drafted reply. Filters (site, Needs Reply) and paging go back to the
 * server so the list stays light however many posts pile up.
 */

const FACE: Record<string, string> = { like: "👍", love: "❤️", care: "🤗", haha: "😆", wow: "😮", sad: "😢", angry: "😡" };

type Filters = { site: string | null; waiting: boolean };

const plural = (v: number | null, word: string) => `${count(v)} ${word}${v === 1 ? "" : "s"}`;

function Faces({ reactions }: { reactions: Record<string, number> | null }) {
  const entries = Object.entries(reactions ?? {}).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-2 text-xs text-zinc-300">
      {entries.map(([k, v]) => (
        <span key={k} title={k}>
          {FACE[k] ?? k} {v}
        </span>
      ))}
    </span>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-2 ${accent ? "border-brand-400/60 bg-brand-500/10" : "border-edge bg-white/[0.02]"}`}>
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`font-display text-xl tabular-nums ${accent ? "text-brand-200" : "text-white"}`}>{value}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${active ? "border-brand-400/60 bg-brand-500/15 text-brand-200" : "border-edge text-zinc-300 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

function PostRow({ post, comments, open, onToggle, onDone }: { post: StoredPost; comments: SocialComment[]; open: boolean; onToggle: () => void; onDone: (c: SocialComment) => void }) {
  const waiting = comments.filter((c) => c.status === "new");
  const handled = comments.filter((c) => c.status !== "new");
  const text = post.text.replace(/\s+/g, " ").trim();
  return (
    <article className="rounded-2xl border border-edge bg-white/[0.02]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full px-3 py-2.5 text-left">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-edge px-2 py-0.5 text-zinc-300">{siteLabel(post.site)}</span>
          <span className="text-zinc-500">{whenET(post.at)}</span>
          {post.waiting > 0 && <span className="rounded-full border border-brand-400/60 bg-brand-500/15 px-2 py-0.5 text-brand-200">{post.waiting} waiting</span>}
          <span className="ml-auto text-zinc-500">{open ? "▾" : "▸"}</span>
        </div>
        <p className={`mt-1 text-sm text-zinc-200 ${open ? "whitespace-pre-wrap" : "line-clamp-1"}`}>{(open ? post.text.trim() : text) || post.url}</p>
        <p className="mt-1 text-xs tabular-nums text-zinc-400">
          {plural(post.likes, "like")} · {plural(post.comments, "comment")} · {plural(post.shares, "share")}
          {post.views != null ? ` · ${plural(post.views, "view")}` : ""}
        </p>
      </button>
      {open && (
        <div className="space-y-3 border-t border-edge/60 px-3 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <a href={post.url} target="_blank" rel="noreferrer" className="text-zinc-300 underline-offset-2 hover:text-white hover:underline">
              Open Post ↗
            </a>
            <Faces reactions={post.reactions} />
            <span className="ml-auto">Counts read {whenET(post.readAt)}</span>
          </div>
          {waiting.length > 0 && (
            <div className="space-y-2">
              {waiting.map((c) => (
                <SocialCommentCard key={c.id} c={c} onDone={onDone} />
              ))}
            </div>
          )}
          {handled.length > 0 && (
            <ul className="space-y-1.5">
              {handled.map((c) => (
                <HandledComment key={c.id} c={c} onDone={onDone} />
              ))}
            </ul>
          )}
          {comments.length === 0 && (
            <p className="text-xs text-zinc-500">
              {post.comments ? "The platform counts comments here that the next check will bring in." : "No comments."}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export default function SocialPosts({ initial }: { initial: PostsPage }) {
  const [data, setData] = useState<PostsPage>(initial);
  const [filters, setFilters] = useState<Filters>({ site: null, waiting: false });
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<"refresh" | "more" | "filter" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const byPost = groupByPost(data.comments);
  const unread = data.sites.filter((s) => s.connected && s.error);
  // Only sites that hold posts get a chip — a connected site with nothing stored (X refusing reads, TikTok private) would filter the page to empty.
  const siteChips = SITE_ORDER.filter((s) => (data.perSite[s] ?? 0) > 0);

  function qs(f: Filters, before?: string): string {
    const p = new URLSearchParams();
    if (f.site) p.set("site", f.site);
    if (f.waiting) p.set("waiting", "1");
    if (before) p.set("before", before);
    return p.toString();
  }

  async function load(f: Filters, append = false) {
    setBusy(append ? "more" : "filter");
    try {
      const before = append ? data.posts[data.posts.length - 1]?.at : undefined;
      const res = await fetch(`/api/admin/social/posts?${qs(f, before)}`, { cache: "no-store" });
      const page = (await res.json()) as PostsPage & { error?: string };
      if (!res.ok) throw new Error(page.error ?? `HTTP ${res.status}`);
      setData((d) =>
        append ? { ...page, posts: [...d.posts, ...page.posts], comments: [...d.comments, ...page.comments], orphans: d.orphans } : page,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function setFilter(next: Partial<Filters>) {
    const f = { ...filters, ...next };
    setFilters(f);
    void load(f);
  }

  async function refresh() {
    setBusy("refresh");
    setNote(null);
    try {
      const res = await fetch("/api/admin/social/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh", site: filters.site, waiting: filters.waiting }),
      });
      const page = (await res.json()) as PostsPage & { refresh?: { posts: number; added: number; hidden: number; replied: number; errors: string[] }; error?: string };
      if (!res.ok) throw new Error(page.error ?? `HTTP ${res.status}`);
      setData(page);
      const r = page.refresh;
      if (r) {
        const bits = [`${r.posts} posts read`, `${r.added} new comment${r.added === 1 ? "" : "s"}`];
        if (r.replied) bits.push(`${r.replied} answered`);
        if (r.hidden) bits.push(`${r.hidden} spam hidden`);
        setNote(bits.join(" · "));
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function flipAutoReply() {
    const on = !data.autoReply;
    setBusy("filter");
    try {
      const res = await fetch("/api/admin/social/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "autoReply", on }) });
      const j = (await res.json()) as { autoReply?: boolean; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setData((d) => ({ ...d, autoReply: j.autoReply === true }));
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function toggle(key: string) {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function done(updated: SocialComment) {
    setData((d) => {
      const wasNew = [...d.comments, ...d.orphans].find((c) => c.id === updated.id)?.status === "new";
      const comments = d.comments.some((c) => c.id === updated.id) ? d.comments.map((c) => (c.id === updated.id ? updated : c)) : d.comments;
      const key = postKey(updated.site, updated.postId);
      const stillWaiting = comments.filter((c) => postKey(c.site, c.postId) === key && c.status === "new").length;
      return {
        ...d,
        comments,
        orphans: d.orphans.filter((c) => c.id !== updated.id),
        posts: d.posts.map((p) => (postKey(p.site, p.postId) === key ? { ...p, waiting: stillWaiting } : p)),
        waiting: Math.max(0, d.waiting - (wasNew && updated.status !== "new" ? 1 : 0)),
      };
    });
  }

  const t = data.totals;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Posts" value={count(t.posts)} />
        <Stat label="Likes" value={count(t.likes)} />
        <Stat label="Comments" value={count(t.comments)} />
        <Stat label="Shares" value={count(t.shares)} />
        <Stat label="Views" value={count(t.views)} />
        <Stat label="Waiting" value={count(data.waiting)} accent={data.waiting > 0} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={filters.site === null} onClick={() => setFilter({ site: null })}>
          All
        </Chip>
        {siteChips.map((s) => (
          <Chip key={s} active={filters.site === s} onClick={() => setFilter({ site: s })}>
            {siteLabel(s)}
            {data.perSite[s] ? <span className="ml-1 text-xs text-zinc-500">{data.perSite[s]}</span> : null}
          </Chip>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-edge sm:block" />
        <Chip active={filters.waiting} onClick={() => setFilter({ waiting: !filters.waiting })}>
          Needs You{data.waiting > 0 ? <span className="ml-1 text-xs">{data.waiting}</span> : null}
        </Chip>
        <button
          type="button"
          onClick={flipAutoReply}
          disabled={busy !== null}
          role="switch"
          aria-checked={data.autoReply}
          title={data.autoReply ? "The robot answers questions and the odd bit of praise itself. Press to hold every reply for your Send." : "Replies wait for your Send. Press to let the robot answer itself."}
          className={`rounded-full border px-3 py-1 text-sm ${data.autoReply ? "border-emerald-400/50 text-emerald-300" : "border-edge text-zinc-400"} disabled:opacity-40`}
        >
          Auto-Reply {data.autoReply ? "On" : "Off"}
        </button>
        <span className="ml-auto text-xs text-zinc-500">{data.readAt ? `Read ${whenET(data.readAt)}` : "Not read yet"}</span>
        <button
          type="button"
          onClick={refresh}
          disabled={busy !== null}
          className="rounded-full bg-brand-500 px-3 py-1 text-sm font-medium text-black hover:bg-brand-400 disabled:opacity-40"
        >
          {busy === "refresh" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {note && <p className="text-xs text-zinc-400">{note}</p>}
      {unread.length > 0 && (
        <details className="text-xs text-amber-300">
          <summary className="cursor-pointer">
            {unread.length} site{unread.length === 1 ? "" : "s"} could not be read
          </summary>
          <ul className="mt-1 space-y-0.5 pl-3 text-amber-200/80">
            {unread.map((s) => (
              <li key={s.site}>
                {s.label}: {s.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.orphans.length > 0 && (
        <section className="rounded-2xl border border-brand-400/40 bg-brand-500/5 p-3">
          <h2 className="mb-2 text-sm font-medium text-white">Comments on other posts · {data.orphans.length}</h2>
          <div className="space-y-2">
            {data.orphans.map((c) => (
              <SocialCommentCard key={c.id} c={c} showSite onDone={done} />
            ))}
          </div>
        </section>
      )}

      {data.posts.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-white/[0.02] p-4 text-sm text-zinc-500">
          {data.readAt ? "No posts match." : "Nothing stored yet. Press Refresh to read every site."}
        </p>
      ) : (
        <div className={`space-y-2 ${busy === "filter" ? "opacity-60" : ""}`}>
          {data.posts.map((p) => {
            const key = postKey(p.site, p.postId);
            return <PostRow key={key} post={p} comments={byPost.get(key) ?? []} open={open.has(key)} onToggle={() => toggle(key)} onDone={done} />;
          })}
        </div>
      )}

      {data.hasMore && (
        <button
          type="button"
          onClick={() => load(filters, true)}
          disabled={busy !== null}
          className="w-full rounded-full border border-edge px-3 py-1.5 text-sm text-zinc-300 hover:text-white disabled:opacity-40"
        >
          {busy === "more" ? "Loading…" : "Show More"}
        </button>
      )}
    </div>
  );
}
