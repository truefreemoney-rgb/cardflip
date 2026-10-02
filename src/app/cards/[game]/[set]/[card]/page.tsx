import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import ArtImg from "@/components/ArtImg";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import { Crumbs, PriceCell, ScanCta, TileGrid } from "@/components/CardPagesUi";
import {
  canonicalRedirect,
  cardHeading,
  cardMetadata,
  factsParagraph,
  gamePath,
  gameTitle,
  gameFromSlug,
  parseCardKey,
  parseCardSegment,
  priceDayLabel,
  setPath,
  type CardFacts,
} from "@/lib/cardPages";
import { STRIP_TILES, loadCardPage, loadCardRecord, publicCardGame, setIndex, setTopTiles, type CardPage, type Tile } from "@/lib/server/cardPages";
import { formatMoney } from "@/lib/listing";
import { priceStaleNote } from "@/lib/priceFlag";
import { breadcrumbGraph, cardGraph } from "@/lib/structuredData";
import { etDate } from "@/lib/time";
import type { GameId } from "@/lib/types";

/**
 * /cards/{game}/{set-slug}/{name-slug}--{key} — one card's price page (SEO sweep 09-30).
 *
 * The key is validated by pattern before anything touches the database; unknown = 404,
 * a request whose slugs are not the canonical ones is sent there with a 308. Rendering is
 * on-demand ISR (nothing built ahead, kept two days, no cookies or headers), the loader is
 * React-cached so generateMetadata and the page share one read, and the price series is
 * read once for the chart, the variant table, the change words and the price guard.
 * A price the guard flags is never printed; a guard that fails prints no price at all.
 */

export const revalidate = 172800;
export const generateStaticParams = async () => [];

type Loaded = { kind: "redirect"; to: string } | { kind: "card"; page: CardPage; strip: Tile[]; setName: string };

/** One read shared by generateMetadata and the page; null = 404. */
const load = cache(async (gameSlug: string, setSlug: string, segment: string): Promise<Loaded | null> => {
  // Pure string checks first: a path that cannot name a card never reaches the database.
  const gameId = gameFromSlug(gameSlug);
  const seg = parseCardSegment(segment);
  if (!gameId || !seg) return null;
  const key = parseCardKey(gameId, seg.key);
  if (!key) return null;
  const game = await publicCardGame(gameSlug);
  if (!game) return null;
  const rec = await loadCardRecord(game, key);
  if (!rec) return null;
  const f = rec.facts;
  const to = canonicalRedirect({ game: gameSlug, set: setSlug, nameSlug: seg.nameSlug, key: seg.key }, f);
  if (to) return { kind: "redirect", to };
  const page = await loadCardPage(rec);
  const index = await setIndex(game);
  const set = index.bySlug.get(f.setSlug);
  const strip = set ? (await setTopTiles(game, set, f.setSlug)).filter((t) => t.key !== f.key).slice(0, STRIP_TILES) : [];
  return { kind: "card", page, strip, setName: f.setName };
});

export async function generateMetadata({ params }: PageProps<"/cards/[game]/[set]/[card]">): Promise<Metadata> {
  const { game, set, card } = await params;
  const l = await load(game, set, card);
  if (!l || l.kind === "redirect") return { title: "Card prices" };
  return cardMetadata(l.page);
}

/** "Holofoil  $12.40" rows: every current printing, each through the guard. */
function PriceTable({ page }: { page: CardPage }) {
  return (
    <dl className="mt-4 divide-y divide-edge rounded-2xl border border-edge bg-surface-1 text-sm">
      {page.prices.map((p) => (
        <div key={p.variant} className="flex items-baseline justify-between gap-3 px-4 py-3">
          <dt className="text-zinc-300">{p.label}</dt>
          <dd className="text-right">
            <PriceCell price={p.flag ? null : p.price} flagged={Boolean(p.flag)} className="text-base" />
            <span className="ml-2 text-xs text-zinc-500">{priceDayLabel(p.day)}</span>
            {p.stale && !p.flag && <span className="block text-xs text-zinc-400">{priceStaleNote(p.stale.days)}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PriceBlock({ page }: { page: CardPage }) {
  const { headline, prices } = page;
  if (headline) {
    return (
      <>
        <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          Market price{prices.length > 1 ? `, ${headline.label}` : ""}
        </p>
        <p className="font-display text-4xl font-bold tabular-nums text-emerald-300 sm:text-5xl">{formatMoney(headline.price)}</p>
        <p className="mt-1 text-sm text-zinc-500">As of {priceDayLabel(headline.day)}. Recorded daily by CardFlip.</p>
        {/* The value has stood 45+ days (10-02): the number stands, this says how old it is. */}
        {headline.stale && <p className="mt-0.5 text-sm text-zinc-400">{priceStaleNote(headline.stale.days)}.</p>}
        {page.changes.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-sm text-zinc-300">
            {page.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </>
    );
  }
  if (prices.length > 0) {
    // Every current price of this card is one the guard does not believe: the sentence, never the number.
    return (
      <p className="mt-5 rounded-lg bg-amber-400/10 px-3 py-2 text-sm leading-snug">
        <PriceCell price={null} flagged />
      </p>
    );
  }
  return <p className="mt-5 text-sm text-zinc-400">No current market price is recorded for this card.</p>;
}

function CardStory({ f, page }: { f: CardFacts; page: CardPage }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-semibold text-white">Price history</h2>
      {page.chart ? (
        <div className="mt-4 rounded-2xl border border-edge bg-surface-1 p-4">
          <PriceHistoryChart cardId={f.id} initialSeries={page.chart} preferVariant={page.headline?.variant ?? null} compact className="text-left" />
        </div>
      ) : page.headline && page.trackingSince ? (
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Tracking since {etDate(`${page.trackingSince}T12:00:00Z`)}. The chart appears once CardFlip has a week of prices for this card.
        </p>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">No price history is shown for this card right now.</p>
      )}
    </section>
  );
}

export default async function CardPricePage({ params }: PageProps<"/cards/[game]/[set]/[card]">) {
  const { game: gameSlug, set: setSlug, card } = await params;
  const l = await load(gameSlug, setSlug, card);
  if (!l) notFound();
  if (l.kind === "redirect") permanentRedirect(l.to);
  const { page, strip } = l;
  const f = page.facts;
  const game: GameId = f.game;
  const name = gameTitle(game);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <JsonLd
        data={breadcrumbGraph([
          { name: "CardFlip", path: "/" },
          { name: "Card Prices", path: "/cards" },
          { name, path: gamePath(game) },
          { name: f.setName, path: setPath(game, f.setSlug) },
        ])}
      />
      <JsonLd data={cardGraph(page)} />
      <MarketingNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Crumbs items={[{ name: "Card Prices", href: "/cards" }, { name, href: gamePath(game) }, { name: f.setName, href: setPath(game, f.setSlug) }, { name: f.name }]} />

        <div className="mt-5 grid gap-6 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] sm:gap-8">
          <div className="mx-auto w-full max-w-[17rem] sm:mx-0">
            <div className="aspect-[5/7] overflow-hidden rounded-2xl border border-edge bg-black/30">
              <ArtImg src={f.image} alt={`${f.name}, ${f.setName}${f.number ? ` ${f.number}` : ""}`} width={500} height={700} priority className="h-full w-full object-cover" />
            </div>
          </div>

          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold leading-tight text-white sm:text-4xl">{cardHeading(f)}</h1>
            <p className="mt-2 text-sm text-zinc-400">
              <Link href={setPath(game, f.setSlug)} className="text-brand-300 transition hover:text-brand-200">
                {f.setName}
              </Link>
              {f.release ? ` · released ${etDate(`${f.release}T12:00:00Z`)}` : ""}
            </p>

            <PriceBlock page={page} />
            {page.prices.length > 1 && <PriceTable page={page} />}

            <div className="mt-6">
              <ScanCta />
            </div>
          </div>
        </div>

        <CardStory f={f} page={page} />

        <section className="mt-10">
          <h2 className="font-display text-2xl font-semibold text-white">About this card</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">{factsParagraph(f)}</p>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-500">
            Prices are market prices in US dollars for the printing shown, recorded once a day. A price that looks wrong is not shown.
          </p>
        </section>

        {strip.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-2xl font-semibold text-white">More from {f.setName}</h2>
            <TileGrid game={game} tiles={strip} />
            <p className="mt-4 text-sm">
              <Link href={setPath(game, f.setSlug)} className="text-brand-300 transition hover:text-brand-200">
                All {f.setName} Prices
              </Link>
              <span className="mx-2 text-zinc-600" aria-hidden>
                ·
              </span>
              <Link href={gamePath(game)} className="text-brand-300 transition hover:text-brand-200">
                {name} Card Prices
              </Link>
            </p>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
