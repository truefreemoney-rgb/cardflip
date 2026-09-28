import Link from "next/link";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { listSocialPosts } from "@/lib/server/socialPosts";
import SocialPosts from "@/components/admin/SocialPosts";

export const dynamic = "force-dynamic";

/**
 * Social posts: every post on every site with its counts and its comments
 * in one place (was /admin/social/pulse + /admin/social/inbox). Opening
 * reads the database only; the inbox cron fills it an hour after each
 * post and Refresh reads the platforms on demand.
 */
export default async function AdminSocialPostsPage() {
  await requireOwnerPage();
  const initial = await listSocialPosts();
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-white">Social Posts</h1>
          <p className="text-sm text-zinc-400">
            Every post with its likes, comments, shares and views, and the comments under it. Counts and comments are read an hour after each post; Refresh reads them now. Spam is hidden on sight; nothing is sent until you press Send.
          </p>
        </div>
        <Link href="/admin/social" className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 hover:text-white">
          ← Social
        </Link>
      </div>
      <SocialPosts initial={initial} />
    </section>
  );
}
