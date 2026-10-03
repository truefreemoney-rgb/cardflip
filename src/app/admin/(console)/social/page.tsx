import Link from "next/link";
import SocialOptimizer from "@/components/admin/SocialOptimizer";
import SocialPreview from "@/components/admin/SocialPreview";
import SocialSites from "@/components/admin/SocialSites";
import TikTokPackage from "@/components/admin/TikTokPackage";
import { currentVideoFor, eastern, siteStatus, slotAt, slotLabel, slotSchedule, socialGames } from "@/lib/server/socialPublish";
import { tagsOn } from "@/lib/socialTags";
import { optimizerStatus } from "@/lib/server/socialOptimize";
import { GAME_NAME, KIND_NAME } from "@/lib/socialOptimize";
import { ensureSchedule } from "@/lib/server/socialSchedule";
import { SOCIAL_SITES } from "@/lib/server/socialSites";
import { loadPackage } from "@/lib/server/socialTiktok";
import { tiktokHandle } from "@/lib/server/sites/tiktok";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { socialDrafts } from "@/lib/server/social";
import { countNew } from "@/lib/server/socialInbox";
import { recentPublishCrash } from "@/lib/server/socialCrash";
import { addDays } from "@/lib/priceSeries";

export const dynamic = "force-dynamic";

/**
 * Social autopilot preview (docs/SOCIAL-AUTOPILOT.md): today's drafts for
 * both games, made from our own price history. No account is needed to
 * look; the publisher routine posts the same drafts once the tokens exist.
 * The TikTok card above them is the hand-over for the by-hand TikTok posts
 * (lib/socialTiktok.ts): tomorrow's three videos and today's, always the real
 * Eastern days, whatever ?day= the drafts below are showing.
 */
export default async function AdminSocialPage({ searchParams }: { searchParams: Promise<{ day?: string; tiktok?: string; pinterest?: string }> }) {
  await requireOwnerPage();
  const { day: raw, tiktok, pinterest } = await searchParams;
  // api/social/<site>/callback lands here with ?<site>=connected or ?<site>=error:<why>.
  const notice =
    tiktok === "connected"
      ? "TikTok connected for its counts on the Posts page. Its videos are posted by hand from the card below."
      : tiktok?.startsWith("error:")
        ? `TikTok connect failed: ${tiktok.slice(6)}`
        : pinterest === "connected"
          ? "Pinterest connected. Every post also pins its picture with a link to cardflip.io."
          : pinterest?.startsWith("error:")
            ? `Pinterest connect failed: ${pinterest.slice(6)}`
            : null;
  // Same day the publisher keys on (Eastern), so after 8pm ET this page does not jump to UTC's tomorrow.
  const today = eastern().day;
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  await ensureSchedule();
  const games = await socialGames();
  const [optimizer, perGame, sites, waiting, tiktokTomorrow, tiktokToday, crash] = await Promise.all([
    optimizerStatus(),
    Promise.all(games.map((g) => socialDrafts(g, day))),
    siteStatus(SOCIAL_SITES),
    countNew(),
    loadPackage(addDays(today, 1)),
    loadPackage(today),
    recentPublishCrash(),
  ]);
  // The tags each draft will actually carry: the standing swaps and a running hashtag trial (lib/socialTags.ts), as the publisher applies them.
  const drafts = perGame.flat().map((d) => ({ ...d, hashtags: tagsOn(d.hashtags, d.day) }));
  // The rendered MP4 for any draft the render job registered (the 1pm movers go out as video), shown before it posts (one made under an older plan does not go out, so it is not shown).
  const videos: Record<string, string> = {};
  for (const d of drafts) {
    const v = await currentVideoFor(d);
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
      {crash && (
        <p role="alert" className="mb-3 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span className="font-semibold text-white">The publisher crashed</span> at{" "}
          {new Date(crash.at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET
          {crash.slot ? ` on the ${crash.slot} slot` : ""}: <span className="font-mono text-xs">{crash.message}</span>
        </p>
      )}
      <SocialSites sites={sites} day={day} slotNow={slotAt()} notice={notice} morningLabel={slotLabel("morning", day)} />
      <SocialOptimizer on={optimizer.on} day={optimizer.day} why={optimizer.why} forDay={optimizer.forDay} picks={optimizer.picks} scores={optimizer.scores} names={KIND_NAME} games={GAME_NAME} />
      <TikTokPackage tomorrow={tiktokTomorrow} today={tiktokToday} handle={tiktokHandle()} />
      <SocialPreview drafts={drafts} videos={videos} schedule={slotSchedule(day)} />
    </section>
  );
}
