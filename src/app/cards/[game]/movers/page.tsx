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
import { publicCardGame } from "@/lib/server/cardPages";
import { gameMovers, hasMovers, type MoverRow } from "@/lib/server/moversPage";
import { MOVER_MIN_PRICE } from "@/lib/server/social";
import { formatMoney } from "@/lib/listing";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbGraph } from "@/lib/structuredData";
import type { GameId } from "@/lib/types";

/**
 * /cards/{game}/movers — the biggest price risers and fallers of the last 7 and
 * 30 days. The list is the social autopilot's (lib/server/social.ts topMovers,
 * same price guards), cached six hours in card_cache. On-demand ISR like the
 * other card pages, but kept six hours, not two days: a week's movers go stale
 * faster than a set list. Both ranges are sections of one page (a ?range switch
 * would make it dynamic).
 */

export const revalidate = 21600;
export const generateStaticParams = async () => [];

const load = cache(async (slug: string): Promise<GameId | null> => {
  const game = await publicCardGame(slug);
  return game && hasMovers(game) ? game : null;
});

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const { game: slug } = await params;
  const game = await load(slug);
  if (!game) return { title: "Card prices" };
  const name = gameTitle(game);
  return pageMetadata({
    title: `${name} price movers: biggest risers and fallers`,
    description: `Which ${name} cards went up or down the most in the last 7 and 30 days. Real market prices, junk and one-off sales left out.`,
    path: `${gamePath(game)}/movers`,
  });
}

function MoverList({ game, rows }: { game: GameId; rows: MoverRow[] }) {
  if (rows.length === 0) return <p className="mt-3 text-sm text-zinc-500">Nothing moved enough to list right now.</p>;
  return (
    <ol className="mt-3 flex flex-col gap-2">
      {rows.map((r) => (
        <li key={`${r.key}-${r.variant}`}>
          <Link href={cardPath(game, r.setSlug, r.name, r.key)} className="flex items-center gap-3 rounded-xl border border-edge bg-surface-1 p-2 transition hover:border-edge-strong">
            <div className="aspect-[5/7] w-10 shrink-0 overflow-hidden rounded bg-black/30">
              {showsInLists(r.image) && <ArtImg src={r.image} alt="" loading="lazy" width={80} height={112} className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{r.name}</p>
              <p className="truncate text-xs text-zinc-500">
                {r.setName}
                {r.variant ? ` · ${r.variant}` : ""}
              </p>
              <p className="text-xs tabular-nums text-zinc-400">
                {formatMoney(r.from)} → {formatMoney(r.to)}
              </p>
            </div>
            <span className={`shrink-0 font-display text-base font-semibold tabular-nums ${r.pct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              {r.pct >= 0 ? "+" : "−"}
              {Math.round(Math.abs(r.pct)).toLocaleString("en-US")}%
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export default async function MoversPage({ params }: { params: Promise<{ game: string }> }) {
  const { game: slug } = await params;
  const game = await load(slug);
  if (!game) notFound();
  const name = gameTitle(game);
  const [week, month] = await Promise.all([gameMovers(game, 7), gameMovers(game, 30)]);
  const ranges = [
    { label: "This Week", days: 7, data: week },
    { label: "Past 30 Days", days: 30, data: month },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <JsonLd data={breadcrumbGraph([{ name: "CardFlip", path: "/" }, { name: "Card Prices", path: "/cards" }, { name, path: gamePath(game) }, { name: "Movers", path: `${gamePath(game)}/movers` }])} />
      <MarketingNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Crumbs items={[{ name: "Card Prices", href: "/cards" }, { name, href: gamePath(game) }, { name: "Movers" }]} />
        <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-5xl">{name} Price Movers</h1>
        <p className="mt-2 max-w-prose leading-relaxed text-zinc-400">
          The {name} cards whose price rose or fell the most. Only cards worth {formatMoney(MOVER_MIN_PRICE)} or more, before and after, and only prices that held for a few days. One-off sales are left out. Updated every few hours.
        </p>
        {ranges.map((r) => (
          <section key={r.days} className="mt-6">
            <h2 className="font-display text-2xl font-semibold text-white">{r.label}</h2>
            <div className="mt-1 grid gap-x-6 gap-y-4 md:grid-cols-2">
              <div>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300">Biggest Risers</h3>
                <MoverList game={game} rows={r.data.up} />
              </div>
              <div>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-[0.14em] text-rose-300">Biggest Fallers</h3>
                <MoverList game={game} rows={r.data.down} />
              </div>
            </div>
          </section>
        ))}
        <div className="mt-8 rounded-2xl border border-edge bg-surface-1 p-5 text-center">
          <p className="font-display text-xl font-semibold text-white">Got {name} cards to price?</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-zinc-400">Point the camera at one. CardFlip finds the printing and the price.</p>
          <ScanCta className="mt-3" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
