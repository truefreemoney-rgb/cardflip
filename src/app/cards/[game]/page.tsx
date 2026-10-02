import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { Crumbs, ScanCta, TileGrid } from "@/components/CardPagesUi";
import { gamePath, gameTitle, INDEX_FLOOR_USD, setPath } from "@/lib/cardPages";
import { gameTopTiles, publicCardGame, setIndex, type SetIndex, type Tile } from "@/lib/server/cardPages";
import { formatMoney } from "@/lib/listing";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbGraph } from "@/lib/structuredData";
import { etDate } from "@/lib/time";
import type { GameId } from "@/lib/types";

/**
 * /cards/{game} — one game's sets, newest first, and its most valuable cards
 * (the dearest catalog prices, each one run through the price guard). On-demand
 * ISR: nothing built ahead, kept two days, two cached reads (the set list and
 * the top list).
 */

export const revalidate = 172800;
export const generateStaticParams = async () => [];

interface Loaded {
  game: GameId;
  index: SetIndex;
  top: Tile[];
}

/** One read shared by generateMetadata and the page; null = no such game (or not public). */
const load = cache(async (slug: string): Promise<Loaded | null> => {
  const game = await publicCardGame(slug);
  if (!game) return null;
  const index = await setIndex(game);
  if (index.sets.length === 0) return null;
  return { game, index, top: await gameTopTiles(game) };
});

export async function generateMetadata({ params }: PageProps<"/cards/[game]">): Promise<Metadata> {
  const { game: slug } = await params;
  const l = await load(slug);
  if (!l) return { title: "Card prices" };
  const sets = l.index.sets.filter((s) => s.qualifying > 0).length;
  return pageMetadata({
    title: `${gameTitle(l.game)} card prices by set`,
    description: `Market prices and price history for ${sets.toLocaleString("en-US")} ${gameTitle(l.game)} sets, most valuable cards first. Checked daily.`,
    path: gamePath(l.game),
  });
}

export default async function GameHubPage({ params }: PageProps<"/cards/[game]">) {
  const { game: slug } = await params;
  const l = await load(slug);
  if (!l) notFound();
  const { game, index, top } = l;
  const name = gameTitle(game);
  const sets = index.sets.filter((s) => s.qualifying > 0);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <JsonLd data={breadcrumbGraph([{ name: "CardFlip", path: "/" }, { name: "Card Prices", path: "/cards" }, { name, path: gamePath(game) }])} />
      <MarketingNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Crumbs items={[{ name: "Card Prices", href: "/cards" }, { name }]} />
        <h1 className="mt-4 font-display text-3xl font-bold text-white sm:text-5xl">{name} card prices</h1>
        <p className="mt-3 max-w-prose leading-relaxed text-zinc-400">
          Market prices for {name} cards, by set. Each card page has the price for the exact printing, how it has moved and the recorded
          history. Sets list cards from {formatMoney(INDEX_FLOOR_USD)} up; a price that looks wrong is not shown.
        </p>

        {top.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-2xl font-semibold text-white">Most valuable cards</h2>
            <TileGrid game={game} tiles={top} showSet />
          </section>
        )}

        <section className="mt-10">
          <h2 className="font-display text-2xl font-semibold text-white">Sets</h2>
          <p className="mt-1 text-sm text-zinc-500">Newest first. The count is cards priced {formatMoney(INDEX_FLOOR_USD)} and up.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((s) => (
              <li key={s.key}>
                <Link
                  href={setPath(game, index.slugOf.get(s.key) ?? "")}
                  className="flex h-full items-baseline justify-between gap-3 rounded-xl border border-edge bg-surface-1 px-4 py-3 transition hover:border-edge-strong"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{s.name}</span>
                    {s.release && <span className="text-xs text-zinc-500">{etDate(`${s.release}T12:00:00Z`, "", { month: "short", year: "numeric" })}</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-400">{s.qualifying.toLocaleString("en-US")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-10 rounded-2xl border border-edge bg-surface-1 p-6 text-center sm:p-8">
          <p className="font-display text-xl font-semibold text-white">Got {name} cards to price?</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">Point the camera at one. CardFlip finds the printing and the price.</p>
          <ScanCta className="mt-4" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
