import Link from "next/link";
import SocialPreview from "@/components/admin/SocialPreview";
import SocialSites from "@/components/admin/SocialSites";
import { eastern, siteStatus, slotAt, socialGames, videoFor } from "@/lib/server/socialPublish";
import { SOCIAL_SITES } from "@/lib/server/socialSites";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { socialDrafts } from "@/lib/server/social";
import { countNew } from "@/lib/server/socialInbox";
import { addDays } from "@/lib/priceSeries";

export const dynamic = "force-dynamic";

/**
 * Social autopilot preview (docs/SOCIAL-AUTOPILOT.md): today's drafts for
 * both games, made from our own price history. No account is needed to
 * look; the publisher routine posts the same drafts once the tokens exist.
 */
export default async function AdminSocialPage({ searchParams }: { searchParams: Promise<{ day?: string; tiktok?: string; pinterest?: string }> }) {
  await requireOwnerPage();
  const { day: raw, tiktok, pinterest } = await searchParams;
  // api/social/<site>/callback lands here with ?<site>=connected or ?<site>=error:<why>.
  const notice =
    tiktok === "connected"
      ? "TikTok connected. It posts the 1pm video, private until the app audit passes."
      : tiktok?.startsWith("error:")
        ? `TikTok connect failed: ${tiktok.slice(6)}`
        : pinterest === "connected"
          ? "Pinterest connected. Every post also pins its picture with a link to cardflip.io."
          : pinterest?.startsWith("error:")
            ? `Pinterest connect failed: ${pinterest.slice(6)}`
            : null;
  // Same day the publisher keys on (Eastern), so after 8pm ET this page does not jump to UTC's tomorrow.
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : eastern().day;
  const games = await socialGames();
  const [perGame, sites, waiting] = await Promise.all([Promise.all(games.map((g) => socialDrafts(g, day))), siteStatus(SOCIAL_SITES), countNew()]);
  const drafts = perGame.flat();
  // The rendered MP4 for any draft the 6:50am job registered (set spotlight), shown before it posts.
  const videos: Record<string, string> = {};
  for (const d of drafts) {
    const v = await videoFor(d);
    if (v) videos[d.id] = v.url;
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-white">Social</h1>
          <p className="text-sm text-zinc-400">What the autopilot posts on {day}. Pictures and words come from our price history; nothing here is typed by hand.</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/admin/social/posts" className="rounded-full border border-brand-400/60 px-3 py-1 text-brand-200 hover:text-white">
            Posts{waiting > 0 ? <span className="ml-1 rounded-full bg-brand-500/20 px-1.5 text-xs">{waiting}</span> : null}
          </Link>
          <Link href={`/admin/social?day=${addDays(day, -1)}`} className="rounded-full border border-edge px-3 py-1 text-zinc-300 hover:text-white">← {addDays(day, -1)}</Link>
          <Link href={`/admin/social?day=${addDays(day, 1)}`} className="rounded-full border border-edge px-3 py-1 text-zinc-300 hover:text-white">{addDays(day, 1)} →</Link>
        </nav>
      </div>
      <SocialSites sites={sites} day={day} slotNow={slotAt()} notice={notice} />
      <SocialPreview drafts={drafts} videos={videos} />
    </section>
  );
}
