import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import ArtImg from "@/components/ArtImg";
import { Crumbs, ScanCta, showsInLists } from "@/components/CardPagesUi";
import { cardPath, gamePath, gameTitle } from "@/lib/cardPages";
import { TOP_LIST, gameTop100, publicCardGame, type Tile } from "@/lib/server/cardPages";
import { formatMoney } from "@/lib/listing";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbGraph } from "@/lib/structuredData";
import { todayUtc } from "@/lib/priceSeries";
import type { GameId } from "@/lib/types";

/**
 * /cards/{game}/most-valuable: the game's 100 most valuable cards (10-17, task #65). The hub's "most valuable" build,
 * 100 deep: the dearest catalog prices, each through the price guard, kept only with a fresh, believed price. Built
 * once a day (card_cache), on-demand ISR kept two days like the other card pages.
 */

export const revalidate = 172800;
export const generateStaticParams = async () => [];

const load = cache(async (slug: string): Promise<{ game: GameId; tiles: Tile[] } | null> => {
  const game = await publicCardGame(slug);
  if (!game) return null;
  return { game, tiles: await gameTop100(game) };
});

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const { game: slug } = await params;
  const l = await load(slug);
  if (!l) notFound();
  const name = gameTitle(l.game);
  const top = l.tiles[0];
  return pageMetadata({
    title: `Top ${TOP_LIST} most valuable ${name} cards ${todayUtc().slice(0, 4)}`,
    absoluteTitle: true,
    description: top
      ? `The ${l.tiles.length} most valuable ${name} cards at today's market prices. Number one: ${top.name} from ${top.setName}${top.price != null && top.price > 0 ? ` at ${formatMoney(top.price)}` : ""}. Checked daily.`
      : `The most valuable ${name} cards at today's market prices. Checked daily.`,
    path: `${gamePath(l.game)}/most-valuable`,
    noindex: l.tiles.length === 0,
  });
}

export default async function MostValuablePage({ params }: { params: Promise<{ game: string }> }) {
  const { game: slug } = await params;
  const l = await load(slug);
  if (!l) notFound();
  const { game, tiles } = l;
  const name = gameTitle(game);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <JsonLd
        data={breadcrumbGraph([
          { name: "CardFlip", path: "/" },
          { name: "Card Prices", path: "/cards" },
          { name, path: gamePath(game) },
          { name: "Most valuable", path: `${gamePath(game)}/most-valuable` },
        ])}
      />
      <MarketingNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <Crumbs items={[{ name: "Card Prices", href: "/cards" }, { name, href: gamePath(game) }, { name: "Most valuable" }]} />
        <h1 className="mt-4 font-display text-3xl font-bold text-white sm:text-5xl">
          Top {TOP_LIST} most valuable {name} cards
        </h1>
        <p className="mt-3 max-w-prose leading-relaxed text-zinc-400">
          The most valuable {name} cards at today&apos;s market prices, Near Mint and ungraded. Checked daily. A price that looks wrong is not shown.
        </p>
        {tiles.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-edge bg-surface-1 px-4 py-10 text-center text-sm text-zinc-400">The list is being built. Check back soon.</p>
        ) : (
          <ol className="mt-6 flex flex-col gap-2">
            {tiles.map((t, i) => (
              <li key={t.key}>
                <Link href={cardPath(game, t.setSlug, t.name, t.key)} className="flex items-center gap-3 rounded-xl border border-edge bg-surface-1 p-2 pr-3 transition hover:border-edge-strong">
                  <span className="w-7 shrink-0 text-center text-sm font-semibold tabular-nums text-zinc-500">{i + 1}</span>
                  <div className="aspect-[5/7] w-10 shrink-0 overflow-hidden rounded bg-black/30">
                    {showsInLists(t.tile || t.image) && <ArtImg src={t.tile || t.image} alt="" loading={i < 8 ? undefined : "lazy"} width={80} height={112} className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{t.name}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {t.setName}
                      {t.tags.length ? ` · ${t.tags.join(", ")}` : ""}
                    </p>
                  </div>
                  {t.price != null && t.price > 0 && <span className="shrink-0 font-display text-base font-semibold tabular-nums text-emerald-300">{formatMoney(t.price)}</span>}
                </Link>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-6 text-sm">
          <Link href={gamePath(game)} className="text-brand-300 transition hover:text-brand-200">
            All {name} sets →
          </Link>
        </p>
        <div className="mt-8 rounded-2xl border border-edge bg-surface-1 p-6 text-center sm:p-8">
          <p className="font-display text-xl font-semibold text-white">Think you have one of these?</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">Scan it. CardFlip finds the exact printing and its price.</p>
          <ScanCta className="mt-4" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
