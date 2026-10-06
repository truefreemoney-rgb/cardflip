import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import ArtImg from "@/components/ArtImg";
import WatchPrice from "@/components/WatchPrice";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import { Crumbs, PriceCell, ScanCta, StickyPriceBar, TileGrid } from "@/components/CardPagesUi";
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
import { STRIP_TILES, loadCardPage, loadCardRecord, otherPrintings, publicCardGame, setIndex, setStanding, setTopTiles, type CardPage, type Tile } from "@/lib/server/cardPages";
import { conditionLadder, rangeWords, rankWords, scanHeading, scanWords, sellMath, sellWords, type SetStanding } from "@/lib/cardStory";
import { formatMoney } from "@/lib/listing";
import { priceStaleNote } from "@/lib/priceFlag";
import { breadcrumbGraph } from "@/lib/structuredData";
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

type Loaded = { kind: "redirect"; to: string } | { kind: "card"; page: CardPage; strip: Tile[]; setName: string; standing: SetStanding | null; printings: Tile[] };

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
  // The three daily-cached lists (set strip, set rank, other printings) are read together; each fails to empty on its own.
  const [top, standing, printings] = await Promise.all([
    set ? setTopTiles(game, set, f.setSlug) : Promise.resolve([] as Tile[]),
    set && page.headline ? setStanding(game, set, f.key) : Promise.resolve(null),
    otherPrintings(game, f),
  ]);
  const strip = top.filter((t) => t.key !== f.key).slice(0, STRIP_TILES);
  return { kind: "card", page, strip, setName: f.setName, standing, printings };
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
        <>
          <div className="mt-4 overflow-hidden rounded-2xl border border-edge bg-surface-1">
            <div className="p-4">
              <PriceHistoryChart cardId={f.id} initialSeries={page.chart} preferVariant={page.headline?.variant ?? null} compact className="text-left" />
            </div>
            {/* The range in words (10-02): server HTML search can read, from guard-checked points only. Sits inside the chart panel as its caption. */}
            {page.range && page.headline && (
              <p className="border-t border-edge bg-black/20 px-4 py-3 text-sm leading-relaxed text-zinc-300">{rangeWords(page.range, page.headline)}</p>
            )}
          </div>
        </>
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

/** One number with its label, inside the sell panel. */
function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-edge bg-black/20 px-3 py-2.5 lg:block">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className={`font-display text-lg font-semibold tabular-nums lg:mt-0.5 ${strong ? "text-emerald-300" : "text-white"}`}>{value}</p>
    </div>
  );
}

/**
 * "Is Charizard worth selling?": the listing math as a panel (Chris 10-02:
 * words fine, make it look better): the verdict large, the three numbers the
 * sentence names as tiles, the sentence itself under them. Null without a
 * headline price the guard let through.
 */
function SellStory({ f, page }: { f: CardFacts; page: CardPage }) {
  const words = page.headline ? sellWords(f.name, page.headline.price) : null;
  if (!words || !page.headline) return null;
  const m = sellMath(page.headline.price);
  const ladder = conditionLadder(page.headline.price);
  return (
    <section className="flex flex-col rounded-2xl border border-edge bg-surface-1 p-5">
      <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">Is {f.name} worth selling?</h2>
      <p className="mt-1 font-display text-4xl font-bold text-emerald-300">{words.verdict}</p>
      <div className="mt-4 grid gap-2 lg:grid-cols-3">
        <Stat label="Market" value={formatMoney(m.market)} />
        <Stat label="eBay Suggested" value={formatMoney(m.ask)} />
        <Stat label="You Keep" value={formatMoney(m.net)} strong />
      </div>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">{words.detail}</p>
      {/* The condition ladder (SEO 10-02): an ESTIMATE per condition: a fixed percentage of the market price (the scanner's own formula), not sold prices. */}
      {ladder.length > 0 && (
        <dl className="mt-4 divide-y divide-edge rounded-xl border border-edge bg-black/20 text-sm">
          <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">Estimated price by condition</div>
          {ladder.map((step) => (
            <div key={step.condition} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <dt className="text-zinc-300">{step.condition}</dt>
              <dd className="font-display font-semibold tabular-nums text-white">{formatMoney(step.ask)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-auto pt-4 text-sm">
        <Link href="/signup" className="font-medium text-brand-300 transition hover:text-brand-200">
          Price your own copy →
        </Link>
      </p>
    </section>
  );
}

/** "Have a Charizard?": the scan angle as the second panel beside the sell story, carrying the one ask. */
function ScanStory({ f }: { f: CardFacts }) {
  return (
    <section className="flex flex-col rounded-2xl border border-brand-500/30 bg-brand-500/10 p-5">
      <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">{scanHeading(f.name)}</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-300">{scanWords(f)}</p>
      <div className="mt-auto pt-5">
        <ScanCta className="w-full sm:w-auto" />
      </div>
    </section>
  );
}

export default async function CardPricePage({ params }: PageProps<"/cards/[game]/[set]/[card]">) {
  const { game: gameSlug, set: setSlug, card } = await params;
  const l = await load(gameSlug, setSlug, card);
  if (!l) notFound();
  if (l.kind === "redirect") permanentRedirect(l.to);
  const { page, strip, standing, printings } = l;
  const f = page.facts;
  const game: GameId = f.game;
  const name = gameTitle(game);
  // Rank in the set (SEO 10-02): one sentence from the daily set ranking, only when the set has company to compare against.
  const rank = standing && page.headline ? rankWords(f.name, f.setName, page.headline.price, standing) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-background pb-[calc(4.5rem+env(safe-area-inset-bottom))] text-foreground md:pb-0">
      <JsonLd
        data={breadcrumbGraph([
          { name: "CardFlip", path: "/" },
          { name: "Card Prices", path: "/cards" },
          { name, path: gamePath(game) },
          { name: f.setName, path: setPath(game, f.setSlug) },
        ])}
      />
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
            {rank && <p className="mt-3 text-sm leading-relaxed text-zinc-300">{rank}</p>}
            {page.prices.length > 1 && <PriceTable page={page} />}

            <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <WatchPrice game={game} id={f.id} />
              <ScanCta secondary />
            </div>
          </div>
        </div>

        <CardStory f={f} page={page} />

        {/* Two panels side by side from sm up: the sell math and the scan ask (Chris 10-02 makeover). */}
        {/* Two columns from sm up: the sell math left; the scan ask and About this card stacked right, the second growing so the columns end level (Chris 10-02: "I hate this empty space"). */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <SellStory f={f} page={page} />
          <div className="flex flex-col gap-4">
            <ScanStory f={f} />
            <section className="flex-1 rounded-2xl border border-edge bg-surface-1 p-5">
              <h2 className="font-display text-lg font-semibold text-white">About this card</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">{factsParagraph(f)}</p>
              <dl className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-black/20 text-sm">
                {[
                  ["Set", f.setName],
                  ["Number", f.number],
                  ["Released", f.release ? etDate(`${f.release}T12:00:00Z`) : ""],
                  ["Rarity", f.rarity],
                  ["Printing", f.tags.join(", ")],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-2">
                      <dt className="text-zinc-500">{k}</dt>
                      <dd className="text-right text-zinc-200">{v}</dd>
                    </div>
                  ))}
              </dl>
              <p className="mt-3 text-sm leading-relaxed text-zinc-500">
                Prices are market prices in US dollars for the printing shown, recorded once a day. A price that looks wrong is not shown.
              </p>
            </section>
          </div>
        </div>

        {/* Other printings of the same card (SEO 10-02): the strongest internal links these pages have, prices through the guard. */}
        {printings.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-2xl font-semibold text-white">Other {f.name} cards</h2>
            <p className="mt-1 text-sm text-zinc-400">Other printings of {f.name} with a current market price, most valuable first.</p>
            <TileGrid game={game} tiles={printings} showSet />
          </section>
        )}

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
      {/* Phones: today's price and the one button stay in reach (hidden from md up). */}
      <StickyPriceBar price={page.headline?.price ?? null}>
        <WatchPrice game={game} id={f.id} />
      </StickyPriceBar>
    </div>
  );
}
