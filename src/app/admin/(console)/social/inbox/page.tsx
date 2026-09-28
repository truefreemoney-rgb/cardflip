import Link from "next/link";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { listComments } from "@/lib/server/socialInbox";
import SocialInbox from "@/components/admin/SocialInbox";

export const dynamic = "force-dynamic";

/**
 * Social inbox: comments and replies on the autopilot's posts, read an hour
 * after each slot (lib/server/socialInbox.ts). Spam is already hidden where
 * the site allows; what is here waits for Chris — Send the drafted reply
 * (edit first if you like), Hide, or Dismiss. Handled ones sit below.
 */
export default async function AdminSocialInboxPage() {
  await requireOwnerPage();
  const [waiting, handled] = await Promise.all([listComments("new"), listComments("handled", 40)]);
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-white">Social Inbox</h1>
          <p className="text-sm text-zinc-400">
            Comments and replies on our posts, checked an hour after every post. Spam is hidden on sight (Bluesky cannot hide, so it is flagged). Nothing is sent until you press Send.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/social/pulse" className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 hover:text-white">
            Pulse
          </Link>
          <Link href="/admin/social" className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 hover:text-white">
            ← Social
          </Link>
        </div>
      </div>
      <SocialInbox waiting={waiting} handled={handled} />
    </section>
  );
}
