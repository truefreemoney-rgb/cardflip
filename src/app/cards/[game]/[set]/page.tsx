import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { Crumbs, ScanCta, TileGrid } from "@/components/CardPagesUi";
import { gamePath, gameTitle, INDEX_FLOOR_USD, setPath, type SetEntry } from "@/lib/cardPages";
import { SET_PAGE_CARDS, loadSetCards, publicCardGame, setBySlug, type SetCard } from "@/lib/server/cardPages";
import { formatMoney } from "@/lib/listing";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbGraph } from "@/lib/structuredData";
import { etDate } from "@/lib/time";
import type { GameId } from "@/lib/types";

/**
 * /cards/{game}/{set-slug} — the cards of one set priced at the floor or more,
 * most valuable first, each with the price the guard believes (a card the guard
 * flags is left off the list: its own page says why). On-demand ISR: nothing
 * built ahead, kept two days. One catalog query plus the guard's batched read.
 * The slug is checked against the game's set list (a cached read) before any
 * card query runs.
 */

export const revalidate = 172800;
export const generateStaticParams = async () => [];

interface Loaded {
  game: GameId;
  set: SetEntry;
  slug: string;
  /** Every card of the set at the floor or more, dearest first. */
  cards: SetCard[];
}

/** One read shared by generateMetadata and the page; null = no such game or set (or the game is not public). */
const load = cache(async (gameSlug: string, setSlug: string): Promise<Loaded | null> => {
  const game = await publicCardGame(gameSlug);
  if (!game) return null;
  const found = await setBySlug(game, setSlug);
  if (!found) return null;
  const all = await loadSetCards(game, found.set);
  return { game, set: found.set, slug: found.slug, cards: all.filter((c) => c.price != null && c.price >= INDEX_FLOOR_USD && !c.unverified) };
});

export async function generateMetadata({ params }: PageProps<"/cards/[game]/[set]">): Promise<Metadata> {
  const { game: gameSlug, set: setSlug } = await params;
  const l = await load(gameSlug, setSlug);
  if (!l) return { title: "Card prices" };
  const name = gameTitle(l.game);
  return pageMetadata({
    title: `${l.set.name} ${name} card prices`,
    absoluteTitle: true,
    description: `Market prices and price history for ${l.cards.length.toLocaleString("en-US")} ${name} cards from ${l.set.name}, most valuable first. TCGplayer prices, checked daily.`,
    path: setPath(l.game, l.slug),
    noindex: l.cards.length === 0,
  });
}

export default async function SetPage({ params }: PageProps<"/cards/[game]/[set]">) {
  const { game: gameSlug, set: setSlug } = await params;
  const l = await load(gameSlug, setSlug);
  if (!l) notFound();
  const { game, set, slug, cards } = l;
  const name = gameTitle(game);
  const shown = cards.slice(0, SET_PAGE_CARDS);
  const tiles = shown.map((c) => ({ ...c, setSlug: slug, setName: set.name }));

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <JsonLd
        data={breadcrumbGraph([
          { name: "CardFlip", path: "/" },
          { name: "Card Prices", path: "/cards" },
          { name, path: gamePath(game) },
          { name: set.name, path: setPath(game, slug) },
        ])}
      />
      <MarketingNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Crumbs items={[{ name: "Card Prices", href: "/cards" }, { name, href: gamePath(game) }, { name: set.name }]} />
        <h1 className="mt-4 font-display text-3xl font-bold text-white sm:text-5xl">
          {set.name} {name} card prices
        </h1>
        <p className="mt-3 max-w-prose leading-relaxed text-zinc-400">
          TCGplayer market prices for {name} cards from {set.name}
          {set.release ? `, released ${etDate(`${set.release}T12:00:00Z`)}` : ""}. Cards priced {formatMoney(INDEX_FLOOR_USD)} and up, most valuable first. A price
          that looks wrong is not shown.
        </p>

        {tiles.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-edge bg-surface-1 px-4 py-10 text-center text-sm text-zinc-400">
            No card in this set has a current price of {formatMoney(INDEX_FLOOR_USD)} or more right now.
          </p>
        ) : (
          <>
            <p className="mt-6 text-sm text-zinc-500">
              {cards.length > shown.length
                ? `Showing the ${shown.length.toLocaleString("en-US")} most valuable of ${cards.length.toLocaleString("en-US")} cards.`
                : `${cards.length.toLocaleString("en-US")} ${cards.length === 1 ? "card" : "cards"}.`}
            </p>
            <TileGrid game={game} tiles={tiles} />
          </>
        )}

        <div className="mt-10 rounded-2xl border border-edge bg-surface-1 p-6 text-center sm:p-8">
          <p className="font-display text-xl font-semibold text-white">Own cards from {set.name}?</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">Scan them. CardFlip matches the printing, prices it and writes the eBay listing.</p>
          <ScanCta className="mt-4" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
