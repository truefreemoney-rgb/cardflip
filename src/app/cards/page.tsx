import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { Crumbs, ScanCta } from "@/components/CardPagesUi";
import { gamePath, gameTitle, INDEX_FLOOR_USD } from "@/lib/cardPages";
import { publicCardGames, setIndex } from "@/lib/server/cardPages";
import { formatMoney } from "@/lib/listing";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbGraph } from "@/lib/structuredData";
import type { GameId } from "@/lib/types";

/**
 * /cards — the front door of the public card price pages (SEO sweep 09-30):
 * one tile per game the public can use, each leading to that game's sets.
 * On-demand ISR like every page under /cards: nothing is built ahead, the
 * page is kept two days, and it reads only the cached set lists.
 */

export const revalidate = 172800;

export const metadata = pageMetadata({
  title: "Card prices",
  description: "Market prices and price history for Pokémon, Magic, Lorcana, One Piece and Yu-Gi-Oh! cards, by set. Checked daily.",
  path: "/cards",
});

export default async function CardsHubPage() {
  const games = await publicCardGames();
  const tiles = (
    await Promise.all(
      games.map(async (game: GameId) => {
        const { sets } = await setIndex(game);
        const priced = sets.filter((s) => s.qualifying > 0);
        return { game, sets: priced.length, cards: priced.reduce((n, s) => n + s.qualifying, 0) };
      }),
    )
  ).filter((t) => t.sets > 0);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <JsonLd data={breadcrumbGraph([{ name: "CardFlip", path: "/" }, { name: "Card Prices", path: "/cards" }])} />
      <MarketingNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Crumbs items={[{ name: "Card Prices" }]} />
        <h1 className="mt-4 font-display text-3xl font-bold text-white sm:text-5xl">Card prices</h1>
        <p className="mt-3 max-w-prose leading-relaxed text-zinc-400">
          What trading cards sell for, by game and set. Each page shows the market price for the exact printing, how it has moved, and the
          price history CardFlip has recorded. Prices are checked daily, and a price that looks wrong is not shown. Pages list cards from{" "}
          {formatMoney(INDEX_FLOOR_USD)} up.
        </p>

        {tiles.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-edge bg-surface-1 px-4 py-10 text-center text-sm text-zinc-400">Card prices are not available right now.</p>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <li key={t.game}>
                <Link href={gamePath(t.game)} className="flex h-full flex-col rounded-2xl border border-edge bg-surface-1 p-5 transition hover:border-edge-strong">
                  <span className="font-display text-xl font-semibold text-white">{gameTitle(t.game)}</span>
                  <span className="mt-1 text-sm text-zinc-400">
                    {t.sets.toLocaleString("en-US")} sets, {t.cards.toLocaleString("en-US")} cards priced {formatMoney(INDEX_FLOOR_USD)} and up
                  </span>
                  <span className="mt-4 text-sm font-medium text-brand-300">See Prices</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 rounded-2xl border border-edge bg-surface-1 p-6 text-center sm:p-8">
          <p className="font-display text-xl font-semibold text-white">Have a binder of these?</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
            CardFlip reads a card from a photo, matches the exact printing and prices it, then writes the eBay listing.
          </p>
          <ScanCta className="mt-4" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
