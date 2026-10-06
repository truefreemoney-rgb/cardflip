import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { Crumbs, ScanCta, TileGrid } from "@/components/CardPagesUi";
import { gamePath, gameTitle, indexFloorUsd, setPath, type SetEntry } from "@/lib/cardPages";
import { SET_PAGE_CARDS, loadSetCards, publicCardGame, setBySlug, type SetCard } from "@/lib/server/cardPages";
import { formatMoney } from "@/lib/listing";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbGraph } from "@/lib/structuredData";
import { etDate } from "@/lib/time";
import { todayUtc } from "@/lib/priceSeries";
import type { GameId } from "@/lib/types";

/**
 * One set's price pages: page 1 is /cards/{game}/{set}, the rest are
 * /cards/{game}/{set}/page/{n} (SET_PAGE_CARDS cards each, most valuable first).
 * Path segments, not ?page=, so every page stays static ISR and every page is a
 * plain crawlable link. Shared by both route files; one cached read serves all pages.
 */

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
  return { game, set: found.set, slug: found.slug, cards: all.filter((c) => c.price != null && c.price >= indexFloorUsd(game) && !c.unverified) };
});

const pageHref = (game: GameId, slug: string, n: number) => (n <= 1 ? setPath(game, slug) : `${setPath(game, slug)}/page/${n}`);

/** The page number a URL asks for: a plain positive integer, or null. */
export function parsePageNumber(raw: string): number | null {
  return /^[1-9]\d{0,3}$/.test(raw) ? Number(raw) : null;
}

export async function setMetadata(gameSlug: string, setSlug: string, page: number): Promise<Metadata> {
  const l = await load(gameSlug, setSlug);
  if (!l) return { title: "Card prices" };
  const name = gameTitle(l.game);
  const pages = Math.max(1, Math.ceil(l.cards.length / SET_PAGE_CARDS));
  return pageMetadata({
    title: `${l.set.name} ${name} card prices${page > 1 ? `, page ${page}` : ""}`,
    absoluteTitle: true,
    description: `Market prices and price history for ${l.cards.length.toLocaleString("en-US")} ${name} cards from ${l.set.name}, most valuable first. Checked daily.${page > 1 ? ` Page ${page} of ${pages}.` : ""}`,
    path: pageHref(l.game, l.slug, page),
    noindex: l.cards.length === 0 || page > pages,
  });
}

function Pager({ game, slug, page, pages }: { game: GameId; slug: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const cell = "flex h-10 min-w-10 items-center justify-center rounded-xl border px-3 text-sm transition";
  return (
    <nav aria-label="Pages" className="mt-6 flex flex-wrap items-center justify-center gap-2">
      {page > 1 && (
        <Link href={pageHref(game, slug, page - 1)} rel="prev" className={`${cell} border-edge bg-surface-1 text-zinc-200 hover:border-edge-strong`}>
          Previous
        </Link>
      )}
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
        n === page ? (
          <span key={n} aria-current="page" className={`${cell} border-brand-400 bg-brand-500/20 font-semibold text-white`}>
            {n}
          </span>
        ) : (
          <Link key={n} href={pageHref(game, slug, n)} className={`${cell} border-edge bg-surface-1 text-zinc-300 hover:border-edge-strong`}>
            {n}
          </Link>
        ),
      )}
      {page < pages && (
        <Link href={pageHref(game, slug, page + 1)} rel="next" className={`${cell} border-edge bg-surface-1 text-zinc-200 hover:border-edge-strong`}>
          Show more
        </Link>
      )}
    </nav>
  );
}

export async function SetView({ gameSlug, setSlug, page }: { gameSlug: string; setSlug: string; page: number }) {
  const l = await load(gameSlug, setSlug);
  if (!l) notFound();
  const { game, set, slug, cards } = l;
  const pages = Math.max(1, Math.ceil(cards.length / SET_PAGE_CARDS));
  if (page > pages) notFound();
  const name = gameTitle(game);
  const from = (page - 1) * SET_PAGE_CARDS;
  const shown = cards.slice(from, from + SET_PAGE_CARDS);
  const tiles = shown.map((c) => ({ ...c, setSlug: slug, setName: set.name }));
  const crumbs = [{ name: "Card Prices", href: "/cards" }, { name, href: gamePath(game) }, page > 1 ? { name: set.name, href: setPath(game, slug) } : { name: set.name }];

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
        <Crumbs items={page > 1 ? [...crumbs, { name: `Page ${page}` }] : crumbs} />
        <h1 className="mt-4 font-display text-3xl font-bold text-white sm:text-5xl">
          {set.name} {name} card prices
        </h1>
        <p className="mt-3 max-w-prose leading-relaxed text-zinc-400">
          Market prices for {name} cards from {set.name}
          {set.release ? `, ${set.release > todayUtc() ? "out" : "released"} ${etDate(`${set.release}T12:00:00Z`)}${set.release > todayUtc() ? " (preorder prices)" : ""}` : ""}. Cards priced {formatMoney(indexFloorUsd(game))} and up, most valuable first. A price
          that looks wrong is not shown.
        </p>

        {tiles.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-edge bg-surface-1 px-4 py-10 text-center text-sm text-zinc-400">
            No card in this set has a current price of {formatMoney(indexFloorUsd(game))} or more right now.
          </p>
        ) : (
          <>
            <p className="mt-6 text-sm text-zinc-500">
              {pages > 1
                ? `Cards ${(from + 1).toLocaleString("en-US")} to ${(from + shown.length).toLocaleString("en-US")} of ${cards.length.toLocaleString("en-US")}, most valuable first.`
                : `${cards.length.toLocaleString("en-US")} ${cards.length === 1 ? "card" : "cards"}.`}
            </p>
            <TileGrid game={game} tiles={tiles} />
            <Pager game={game} slug={slug} page={page} pages={pages} />
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

/** /page/1 is the set page itself. */
export async function redirectPageOne(gameSlug: string, setSlug: string): Promise<never> {
  const l = await load(gameSlug, setSlug);
  if (!l) notFound();
  permanentRedirect(setPath(l.game, l.slug));
}
