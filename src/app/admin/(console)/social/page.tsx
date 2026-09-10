import Link from "next/link";
import SocialPreview from "@/components/admin/SocialPreview";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { socialDrafts } from "@/lib/server/social";
import { addDays, todayUtc } from "@/lib/priceSeries";

export const dynamic = "force-dynamic";

/**
 * Social autopilot preview (docs/SOCIAL-AUTOPILOT.md): today's drafts for
 * both games, made from our own price history. No account is needed to
 * look; the publisher routine posts the same drafts once the tokens exist.
 */
export default async function AdminSocialPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  await requireOwnerPage();
  const { day: raw } = await searchParams;
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayUtc();
  const [pokemon, mtg] = await Promise.all([socialDrafts("pokemon", day), socialDrafts("mtg", day)]);
  const drafts = [...pokemon, ...mtg];
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-white">Social</h1>
          <p className="text-sm text-zinc-400">What the autopilot posts on {day}. Pictures and words come from our price history; nothing here is typed by hand.</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href={`/admin/social?day=${addDays(day, -1)}`} className="rounded-full border border-edge px-3 py-1 text-zinc-300 hover:text-white">← {addDays(day, -1)}</Link>
          <Link href={`/admin/social?day=${addDays(day, 1)}`} className="rounded-full border border-edge px-3 py-1 text-zinc-300 hover:text-white">{addDays(day, 1)} →</Link>
        </nav>
      </div>
      <SocialPreview drafts={drafts} />
    </section>
  );
}
