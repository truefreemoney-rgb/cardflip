import Link from "next/link";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { socialPulse, type PulsePost, type SitePulse } from "@/lib/server/socialPulse";

export const dynamic = "force-dynamic";

const FACE: Record<string, string> = {
  like: "👍",
  love: "❤️",
  care: "🤗",
  haha: "😆",
  wow: "😮",
  sad: "😢",
  angry: "😡",
};

function n(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("en-US");
}

function when(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function Faces({ reactions }: { reactions?: Record<string, number> }) {
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

function Row({ post, showViews }: { post: PulsePost; showViews: boolean }) {
  const text = post.text.replace(/\s+/g, " ").trim();
  return (
    <tr className="border-t border-edge/60 text-sm">
      <td className="whitespace-nowrap py-2 pr-3 text-xs text-zinc-500">{when(post.at)}</td>
      <td className="max-w-[28rem] py-2 pr-3">
        <a href={post.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-zinc-200 hover:text-white">
          {text || post.url}
        </a>
        <Faces reactions={post.reactions} />
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{n(post.likes)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{n(post.comments)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{n(post.shares)}</td>
      {showViews && <td className="py-2 text-right tabular-nums">{n(post.views)}</td>}
    </tr>
  );
}

function Site({ s }: { s: SitePulse }) {
  const showViews = s.totals.views != null;
  return (
    <div className="rounded-2xl border border-edge bg-white/[0.02] p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">{s.label}</h2>
        {s.connected && !s.error && (
          <p className="text-sm text-zinc-300">
            <span className="text-zinc-500">{s.totals.posts} posts ·</span> {n(s.totals.likes)} likes · {n(s.totals.comments)} comments · {n(s.totals.shares)} shares
            {showViews ? ` · ${n(s.totals.views)} views` : ""}
          </p>
        )}
      </div>
      {s.totals.reactions && (
        <div className="mb-2">
          <Faces reactions={s.totals.reactions} />
        </div>
      )}
      {!s.connected ? (
        <p className="text-sm text-zinc-500">Not connected.</p>
      ) : s.error ? (
        <p className="text-sm text-amber-300">{s.error}</p>
      ) : s.posts.length === 0 ? (
        <p className="text-sm text-zinc-500">No posts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="pb-1 pr-3 font-medium">When</th>
                <th className="pb-1 pr-3 font-medium">Post</th>
                <th className="pb-1 pr-3 text-right font-medium">Likes</th>
                <th className="pb-1 pr-3 text-right font-medium">Comments</th>
                <th className="pb-1 pr-3 text-right font-medium">Shares</th>
                {showViews && <th className="pb-1 text-right font-medium">Views</th>}
              </tr>
            </thead>
            <tbody>
              {s.posts.map((p) => (
                <Row key={p.url} post={p} showViews={showViews} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Post health across every site: likes, comments, shares, views and
 * Facebook's reaction faces on the latest posts, read live from each
 * platform (lib/server/socialPulse.ts). Nothing is cached — every open is
 * a fresh read, which is what a pulse is for.
 */
export default async function AdminSocialPulsePage() {
  await requireOwnerPage();
  const sites = await socialPulse();
  const live = sites.filter((s) => s.connected && !s.error);
  const total = {
    posts: live.reduce((a, s) => a + s.totals.posts, 0),
    likes: live.reduce((a, s) => a + s.totals.likes, 0),
    comments: live.reduce((a, s) => a + s.totals.comments, 0),
    shares: live.reduce((a, s) => a + s.totals.shares, 0),
  };
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-white">Social Pulse</h1>
          <p className="text-sm text-zinc-400">
            Latest posts on every site with their likes, comments, shares and views, read live. Across {total.posts} posts: {n(total.likes)} likes · {n(total.comments)} comments · {n(total.shares)} shares.
          </p>
        </div>
        <Link href="/admin/social" className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 hover:text-white">
          ← Social
        </Link>
      </div>
      <div className="grid gap-3">
        {sites.map((s) => (
          <Site key={s.site} s={s} />
        ))}
      </div>
    </section>
  );
}
