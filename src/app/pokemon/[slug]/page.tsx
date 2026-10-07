import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import { ScanCta, TileGrid } from "@/components/CardPagesUi";
import { nameTiles, publicCardGame } from "@/lib/server/cardPages";
import { nameLandingPath, parseNameLanding } from "@/lib/nameLandings";
import { formatMoney } from "@/lib/listing";
import { pageMetadata } from "@/lib/seo";

/**
 * Ad landing page for one Pokémon name (lib/nameLandings.ts): the search was "charizard card value", the ad said
 * "Charizard Card Value", so the page says it too and shows every Charizard printing priced today, dearest first.
 * Ads-only for now (noindex) so it does not compete with the /cards pages in search.
 */

export const revalidate = 86400;
export const generateStaticParams = async () => [];

const load = cache(async (segment: string) => {
  const landing = parseNameLanding(segment);
  if (!landing || !(await publicCardGame("pokemon"))) return null;
  return { ...landing, ...(await nameTiles("pokemon", landing.name)) };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const l = await load((await params).slug);
  if (!l) return { title: "Card prices" };
  return pageMetadata({
    title: `${l.name} Card Value: Every ${l.name} Pokémon Card Price Today`,
    absoluteTitle: true,
    description: `${l.name} card value for ${l.priced.toLocaleString("en-US")} ${l.name} Pokémon cards, most valuable first. Scan yours to find the exact printing and its market price.`,
    path: nameLandingPath(l.slug),
    noindex: true,
  });
}

export default async function NameLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const l = await load((await params).slug);
  if (!l) notFound();
  const { name, tiles, priced } = l;
  const top = tiles[0]?.price ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MarketingNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="font-display text-3xl font-bold text-white sm:text-5xl">{name} Card Value</h1>
        <p className="mt-2 max-w-prose leading-relaxed text-zinc-400">
          Every {name} Pokémon card and its market price today, most valuable first. Not sure which {name} you have? Scan it and CardFlip finds the exact printing.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:w-fit">
          <Link
            href="/scan?game=pokemon"
            className="flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-brand-500 to-violet-500 px-6 font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:brightness-110"
          >
            Scan Your {name} Card Free
          </Link>
          {/* Chris, 10-07: a straight path to signup under the scan button for ad visitors. */}
          <Link
            href="/signup"
            className="flex h-12 items-center justify-center rounded-2xl border border-edge bg-surface-1 px-6 font-semibold text-white transition hover:border-brand-400"
          >
            Start Your Free Trial
          </Link>
        </div>

        {tiles.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-edge bg-surface-1 px-4 py-10 text-center text-sm text-zinc-400">
            {name} card prices are loading. Scan your card to see its price now.
          </p>
        ) : (
          <>
            <p className="mt-6 text-sm text-zinc-500">
              {priced.toLocaleString("en-US")} {name} cards priced{top != null ? ` · most valuable ${formatMoney(top)}` : ""}
              {priced > tiles.length ? ` · top ${tiles.length} shown` : ""}
            </p>
            <TileGrid game="pokemon" tiles={tiles} showSet />
          </>
        )}

        <div className="mt-8 rounded-2xl border border-edge bg-surface-1 p-6 text-center sm:p-8">
          <p className="font-display text-xl font-semibold text-white">What is your {name} card worth?</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">Point your phone at it. CardFlip matches the printing and shows today&apos;s {name} card price.</p>
          <ScanCta className="mt-4" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
