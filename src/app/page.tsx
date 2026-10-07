import Link from "next/link";
import { preconnect } from "react-dom";
import MarketingNav from "@/components/MarketingNav";
import TrialCta from "@/components/TrialCta";
import Footer from "@/components/Footer";
import HoloCard from "@/components/HoloCard";
import JsonLd from "@/components/JsonLd";
import { PUBLIC_META } from "@/lib/pageMeta";
import { siteGraph } from "@/lib/structuredData";
import HeroRelayout from "@/components/HeroRelayout";
import CardWall from "@/components/CardWall";
import DemoInventory from "@/components/DemoInventory";
import PlanCard from "@/components/PlanCard";
import { PRICE, SCANS } from "@/lib/pricing";
import { getFeaturedCard, getShowcaseCards } from "@/lib/tcg";
import { GATED_GAMES, gamePublic, magicPublic } from "@/lib/server/settings";
import { getGameStageCards, type StageCard } from "@/lib/server/stageCards";
import { wallCards } from "@/lib/server/wallCards";
import { GAMES } from "@/lib/games";
import { catalogSizeLabel } from "@/lib/server/catalogStats";
import { getPriceHistory } from "@/lib/server/priceHistory";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import type { Series } from "@/lib/client/priceHistoryData";
import { loadTrustData, withPriceFlags } from "@/lib/server/priceTrustSite";
import { CHART_MIN_POINTS } from "@/lib/cardPages";
import { buildListing, formatMoney, plausiblePrices, quotePrice } from "@/lib/listing";
import { COST_COVERED_MAX_USD, COST_TAPER_END_USD, EBAY_FEE_RATE, EBAY_FLAT_FEE, EBAY_FLAT_FEE_OVER_10, EBAY_FLAT_FEE_STEP_USD, POSTAGE_USD, ebayFlatFee, netAfterFees } from "@/lib/fees";
import type { GameId, PokemonCard } from "@/lib/types";
import LiveStatsStrip from "@/components/LiveStatsStrip";
import { liveStats } from "@/lib/server/liveStats";

/**
 * The landing page (makeover 09-04, Chris: "the first thing prospecting
 * paying users will see — it needs to be exceptional"). Structure:
 * hero with the scanner itself as the showpiece → three steps, each with the real UI it produces → a bento of what the
 * product does for a pile of cards → one plan → questions → final ask.
 *
 * Data honesty (docs/DESIGN.md): every card, price, chart point and fee
 * figure on this page is real — the featured card is fetched live, the
 * sparkline is our own recorded history, fees are the constants the app
 * prices with. Sections that need data skip cleanly when it's missing.
 *
 * Holo rationing: the animated foil appears on the H1, the phone's price
 * (the one showpiece), and the step numerals. Nothing else.
 */

/** "Pokémon, Magic: The Gathering and Disney Lorcana" — the games this viewer can scan, in the switch's order. */
function gameList(games: GameId[]): string {
  const names = games.map((g) => (g === "pokemon" ? "Pokémon" : GAMES[g].fullName));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

const faqs = (games: GameId[]) => [
  {
    q: "Which cards does it work on?",
    a:
      games.length > 1
        ? `Any English ${gameList(games)} card, from the first sets to the current ones. Japanese and Chinese support is built and will be switched on later.`
        : "Any English card in the Pokémon TCG catalog, from Base Set to the current sets. Japanese and Chinese support is built and will be switched on later, and more games are on the way.",
  },
  {
    q: "What if the scan picks the wrong printing?",
    a: "Every card shows its match beside your photo, with a \"Not your card?\" list of every printing that shares the name. Tap the right one and the price, title and listing follow it. Verification is one tap and it's remembered.",
  },
  {
    q: "Where do the prices come from?",
    a: `The market price for the exact printing and variant, adjusted for the condition you pick, with live eBay asking prices as a reference. Cards under $${COST_COVERED_MAX_USD} are priced at their value plus eBay's cut and postage, so a cheap card still pays you what it's worth. From $${COST_COVERED_MAX_USD} to $${COST_TAPER_END_USD} part of those costs is added, less as the price goes up.`,
  },
  {
    q: "Do I need my own eBay account?",
    a: "Only if you want to sell. Collectors can just scan and price. To sell, you connect it once. CardFlip writes the listing and publishes it under your account, so payouts and buyer messages come straight to you. Change the price in CardFlip and the live listing updates in place.",
  },
  {
    q: "Does it work on my phone?",
    a: "Yes. CardFlip runs in Safari or Chrome, and on iPhone you can add it to the home screen for a full-screen scanner. The camera is the only way to add a card, on purpose: eBay rejects listings that reuse stock pictures, so every card carries the photo you took. Searching a price by name is free.",
  },
  {
    q: "What does it cost?",
    a: `Your first ${SCANS.trial} scans are free, no card needed: scan, price, build your inventory. Then a ${PRICE.pack} Booster buys ${SCANS.pack} scans with no subscription, or ${PRICE.standard} a month gets ${SCANS.standard} scans, live pricing, eBay publishing, inventory and the watchlist (Pro: ${SCANS.pro} scans for ${PRICE.pro}). Cancel any time. You keep 100% of every eBay payout.`,
  },
];

const steps = [
  {
    title: "Point the camera",
    body: "Fill the frame, tap Capture. CardFlip reads the name and collector number off the photo, and the 1st Edition stamp when there is one.",
  },
  {
    title: "Get the real price",
    body: "It matches the exact printing, pulls the live market price for that variant, and adjusts for the condition you pick. Quick sale or full value, your call.",
  },
  {
    title: "Post it",
    body: "Title, description, photo and price are written for you. Review, tap Post, and it's live on your eBay. Repricing later changes the listing in place.",
  },
];

function marketOf(card: PokemonCard): number | null {
  const best = card.prices
    .filter((p) => p.source === "tcgplayer" && p.currency === "USD")
    .map((p) => p.market ?? 0)
    .filter((n) => n > 0);
  return best.length ? Math.max(...best) : null;
}

function money(n: number): string {
  return n >= 1000
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : `$${n.toFixed(2)}`;
}

/**
 * Four numbers from the featured card's recorded history (newest point last):
 * the move over 30 and 90 days and the high and low of the window shown.
 */
function historyStats(points: { day: string; price: number }[]): { label: string; value: string; tone: string }[] {
  const last = points[points.length - 1];
  const change = (days: number) => {
    const from = points[Math.max(0, points.length - 1 - days)];
    if (!from || from === last || from.price <= 0) return null;
    const pct = ((last.price - from.price) / from.price) * 100;
    return { label: `${days} days`, value: `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`, tone: pct >= 0 ? "text-emerald-300" : "text-rose-300" };
  };
  const prices = points.map((p) => p.price);
  return [
    change(30),
    change(90),
    { label: "High", value: money(Math.max(...prices)), tone: "text-white" },
    { label: "Low", value: money(Math.min(...prices)), tone: "text-white" },
  ].filter((s): s is { label: string; value: string; tone: string } => s !== null);
}

/** The corner brackets of the scanner's viewfinder guide. */
function Brackets() {
  const c = "absolute h-6 w-6 border-holo-sky/80";
  return (
    <>
      <span className={`${c} left-2 top-2 rounded-tl-md border-l-2 border-t-2`} aria-hidden />
      <span className={`${c} right-2 top-2 rounded-tr-md border-r-2 border-t-2`} aria-hidden />
      <span className={`${c} bottom-2 left-2 rounded-bl-md border-b-2 border-l-2`} aria-hidden />
      <span className={`${c} bottom-2 right-2 rounded-br-md border-b-2 border-r-2`} aria-hidden />
    </>
  );
}

// Static with a daily re-render (see git history for the Fly-era
// force-dynamic story). Revalidate keeps the price chips fresh-ish.
export const revalidate = 86400;

export const metadata = PUBLIC_META.home;

/** The origin of an image URL, or null: what the browser should connect to before the hero picture is asked for. */
function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const magic = await magicPublic();
  // Every game the public can scan, in the switch's order (09-30, Chris:
  // "include the new games"). Admin-only games stay off the landing page.
  const gated = await Promise.all(GATED_GAMES.map(async (g) => ((await gamePublic(g)) ? g : null)));
  const games: GameId[] = ["pokemon", ...(["mtg", "lorcana", "onepiece", "yugioh"] as const).filter((g) => gated.includes(g))];
  const [featuredLive, showcaseMirror, catalogLabel, stages, stats] = await Promise.all([
    getFeaturedCard(),
    // The wall recipe (lib/wallMix.ts): 4 Pokémon, 2 Magic, 2 other games, each printing picked for its history.
    wallCards(games),
    catalogSizeLabel(),
    // One real, priced card per game for the games strip; a game whose
    // mirror has nothing to show is skipped (data honesty, DESIGN.md).
    Promise.all(games.map(async (g) => ({ game: g, card: (await getGameStageCards(g).catch(() => ({ cards: [] as StageCard[] }))).cards.find((c) => c.lead) ?? null }))),
    liveStats(),
  ]);
  const gameCards = stages.filter((s): s is { game: GameId; card: StageCard } => !!s.card);
  // No mirrors here (fresh dev DB): the old upstream showcase, so the page still has a wall to show.
  const showcaseLive = showcaseMirror.length >= 8 ? showcaseMirror : await getShowcaseCards(magic);

  // Data honesty: the hero card and the wall show real prices, so a card whose market the price guard flags
  // (lib/server/priceTrustSite.ts) is dropped BEFORE the pick, exactly as the stage strip does. Fails open.
  const guarded = await withPriceFlags([...(featuredLive ? [featuredLive] : []), ...showcaseLive]).catch(() => [...(featuredLive ? [featuredLive] : []), ...showcaseLive]);
  const priceOk = (c: PokemonCard) => !c.prices.some((p) => p.untrusted);
  // Every wall card opens a price chart, so a card with no recorded history is not shown at all (Chris 10-02: "has to
  // be perfect"; a modal saying "no price recorded yet" reads as a bug). CHART_MIN_POINTS priced days of one USD
  // series, the same bar the public card pages use. One batched read; a read that fails keeps the wall (fails open).
  const trust = await loadTrustData(guarded.map((c) => ({ cardId: c.id, game: c.game ?? "pokemon" }))).catch(() => null);
  const charted = (c: PokemonCard) => {
    if (!trust) return true;
    const d = trust.get(c.id);
    return !!d && d.series.some((s) => s.prices.filter((p) => p != null).length >= CHART_MIN_POINTS);
  };
  const showcase = showcaseLive.filter((c, i) => priceOk(guarded[(featuredLive ? 1 : 0) + i]) && charted(c));
  // The hero, the variants tile, the listing step and the price history all hang off `featured`: when the pick is
  // flagged or the lookup fails, the dearest wall card stands in instead of four blanks (Chris 10-02: "it's blank?").
  const featured = featuredLive && priceOk(guarded[0]) && charted(featuredLive) ? featuredLive : (showcase[0] ?? null);

  const heroCard = featured ?? showcase[0] ?? null;
  // The hero picture is the page's LCP: open the connection to its host while the HTML is still parsing.
  const heroHost = originOf(heroCard?.imageLarge || heroCard?.imageSmall);
  if (heroHost) preconnect(heroHost);
  const market = heroCard ? quotePrice(heroCard, "Near Mint", "market") : null;
  const quick = heroCard ? quotePrice(heroCard, "Near Mint", "quick") : null;
  const listing =
    featured && quick ? buildListing(featured, quick.suggested, "Near Mint", quick.price.label) : null;
  // USD only (Chris 09-26: the site is American dollars, never a EUR row).
  const usdVariants = (c: PokemonCard) => plausiblePrices(c.prices).filter((p) => p.market && p.currency === "USD").slice(0, 4);
  // The variants tile wants a card with MORE THAN ONE priced finish (Chris 10-02: one "Holofoil" row looked weird);
  // the featured card leads when it has them, otherwise the wall card with the most.
  const variantCard =
    [featured, ...showcase].filter((c): c is PokemonCard => !!c).sort((a, b) => usdVariants(b).length - usdVariants(a).length)[0] ?? null;
  const variants = variantCard ? usdVariants(variantCard) : [];
  // The eBay tile's one-card story: a wall card the strip does not lead with, listed at market and repriced 7% under.
  const ebayDemo = (() => {
    const pool = [...showcase.slice(8), ...showcase.slice(0, 8).reverse()];
    const card = pool.find((c) => (marketOf(c) ?? 0) >= 5) ?? null;
    if (!card) return null;
    const listed = marketOf(card)!;
    return { card, listed, repriced: Math.max(1, Math.round(listed * 0.93 * 100) / 100) };
  })();
  // The binder tile's summary row: the eight wall cards as an Inventory would count them (statuses are the demo's).
  const wall = showcase.slice(0, 8);
  const binder = (() => {
    if (wall.length < 8) return null;
    // Both totals cover ALL eight (Chris 10-02): listed = the eBay Suggested Price of each, sold = what the seller keeps
    // after eBay fees and postage when every one sells at that price.
    const asks = wall.map((c) => marketOf(c) ?? 0);
    const liveValue = asks.reduce((n, a) => n + a, 0);
    const soldValue = asks.reduce((n, a) => n + Math.max(0, netAfterFees(a) - POSTAGE_USD), 0);
    const games = new Set(wall.map((c) => c.game ?? "pokemon")).size;
    return { count: wall.length, liveValue, fees: liveValue - soldValue, soldValue, games };
  })();

  // Our own recorded history for the hero card — the last 90 points of the
  // variant the quote is based on (falls back to the longest USD series).
  let history: { day: string; price: number }[] = [];
  // The USD series themselves feed the real chart (the card pages' PriceHistoryChart, 10-02: the stretched
  // sparkline "hurts my eyes"); `history` stays as the gate for showing the tile's chart at all.
  let chartSeries: Series[] = [];
  if (featured) {
    try {
      const series = await getPriceHistory(featured.id);
      const usd = series.filter((s) => s.currency === "USD" && s.source === "tcgplayer");
      const pick =
        usd.find((s) => s.variant === market?.price.variant) ??
        usd.slice().sort((a, b) => b.points.length - a.points.length)[0];
      history = pick ? pick.points.slice(-90) : [];
      chartSeries = usd.map((s) => ({ variant: s.variant, source: s.source, currency: s.currency, points: s.points }));
    } catch {
      history = [];
    }
  }

  const feePct = `${(EBAY_FEE_RATE * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Who we are and what it costs: the landing page only, not every page of the site. */}
      <JsonLd data={siteGraph()} />
      <MarketingNav />

      <main className="flex w-full flex-1 flex-col">
        {/* ============================== Hero ============================== */}
        {/* Seamless (Chris, 09-04): no section backgrounds on this page — the
            body ambient is the only ground, so there is nothing to transition
            between. The only local light is the glow behind the phone.
            NO overflow rule on this section: overflow-hidden clipped the
            glow at the bottom (Chris, twice: "it's supposed to flow
            together"), and overflow-x-clip left the hero stuck at the
            landscape width on iOS after rotating back to portrait (Chris
            09-28, only this section, everything below fine). The glow is
            sized to stay inside the viewport instead. */}
        <section id="hero" className="relative">
          <HeroRelayout targetId="hero" />
          {/* Plain column on phones and tablets, grid only from lg: one less
              layout mode for iOS to get wrong on rotation. */}
          <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 pb-6 pt-10 sm:pt-12 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:pb-8">
            {/* Centered until the two-column layout kicks in at lg: between
                640 and 1023px (iPhone landscape, iPad) the phone sits centered
                below the copy, so left-aligned copy read as lopsided. */}
            <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
              <LiveStatsStrip stats={stats} className="text-left" />
              <div className="animate-fade-up foil-edge inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-zinc-200">
                {games.map((g) => (g === "pokemon" ? "Pokémon TCG" : GAMES[g].label)).join(" · ")}
              </div>

              <h1
                className="animate-fade-up font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl"
                style={{ animationDelay: "60ms" }}
              >
                Your binder is
                <br />
                worth money.
                <br />
                <span className="holo-text">Find out how much.</span>
              </h1>

              <p className="animate-fade-up max-w-md text-lg leading-relaxed text-zinc-400" style={{ animationDelay: "120ms" }}>
                Point your phone at a card. CardFlip reads it, matches the exact
                printing, pulls the live market price and writes the eBay
                listing. You tap Post.
              </p>

              <div className="animate-fade-up flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row" style={{ animationDelay: "180ms" }}>
                <TrialCta className="sheen rounded-full bg-brand-500 px-8 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:-translate-y-0.5 hover:bg-brand-400" />
                <a
                  href="#how-it-works"
                  className="rounded-full border border-edge px-8 py-3.5 text-center text-sm font-semibold text-zinc-200 transition hover:-translate-y-0.5 hover:bg-surface-2"
                >
                  See How It Works
                </a>
              </div>

              <ul className="animate-fade-up mt-2 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-zinc-500 lg:justify-start" style={{ animationDelay: "240ms" }}>
                {[
                  `${catalogLabel} printings, each priced on its own`,
                  "Market price plus live eBay comps",
                  "Your eBay account, your payout",
                ].map((line) => (
                  <li key={line} className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-holo-violet" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            {/* The scanner itself, mid-match, with a real card and its real
                price. The phone is the product; the price is the one
                rationed showpiece on this page. */}
            {heroCard && (
              <div className="animate-fade-up relative mx-auto w-[280px] sm:w-[300px]" style={{ animationDelay: "150ms" }}>
                {/* Glow = plain radial gradients that fade to transparent on
                    their own. No filter blur (iOS clipped the blurred layer
                    into a hard line above How it works) and no mask-image
                    (one more compositing feature iOS can hold stale across a
                    rotation). Stays inside the viewport on every phone. */}
                <div
                  className="absolute -inset-x-8 -inset-y-24 bg-[radial-gradient(ellipse_at_50%_45%,rgba(167,139,250,0.55),rgba(125,211,252,0.28)_38%,rgba(240,171,252,0.14)_56%,transparent_72%)]"
                  aria-hidden
                />
                <div className="relative rounded-[2.6rem] border border-edge-strong bg-[#0b0d13] p-2 shadow-2xl shadow-black/70">
                  <div className="overflow-hidden rounded-[2.1rem] bg-black/70">
                    <div className="flex items-center justify-between px-5 pt-4 text-[11px]">
                      <span className="text-zinc-400">
                        1 card · <span className="font-medium text-zinc-200">{market ? money(market.base) : "—"}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                        Match
                      </span>
                    </div>

                    <div className="relative mx-4 mt-3 aspect-[5/7] overflow-hidden rounded-xl bg-black/40">
                      <HoloCard src={heroCard.imageLarge || heroCard.imageSmall} alt={`${heroCard.name} — ${heroCard.setName}`} className="h-full w-full" priority />
                      <Brackets />
                    </div>

                    <div className="mx-4 mt-3 rounded-xl border border-edge bg-surface-1 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Found</span>
                        <span className="text-[10px] text-zinc-500">{heroCard.rarity ?? "Near Mint"}</span>
                      </div>
                      <p className="mt-1 truncate font-display text-base font-semibold text-white">{heroCard.name}</p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {heroCard.setName} · {heroCard.number}
                      </p>
                      {market && (
                        <p className="mt-2 flex items-baseline gap-2">
                          <span className="holo-text font-display text-2xl font-bold">{formatMoney(market.base, market.price.currency)}</span>
                          <span className="text-[10px] text-zinc-500">Market price · {market.price.label}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-center py-4">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-white/80" aria-hidden>
                        <span className="h-8 w-8 rounded-full bg-white/90" />
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-center text-[11px] text-zinc-500">
                  Real card, live market price.
                  <span className="hidden lg:inline"> Move your cursor over it.</span>
                </p>
              </div>
            )}
          </div>
        </section>

        {/* =========================== How it works ========================= */}
        <section id="how-it-works" className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 pb-10 pt-6 sm:scroll-mt-20 sm:pb-12 sm:pt-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">How it works</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-5xl">
              Scanning takes a second.
              <br />
              CardFlip does the other nine minutes.
            </h2>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            {steps.map((step, i) => (
              <div key={step.title} className="reveal flex flex-col overflow-hidden rounded-3xl border border-edge bg-surface-1">
                <div className="p-5 pb-0">
                  <div className="holo-text font-display text-6xl font-bold leading-none" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <h3 className="mt-4 font-display text-2xl font-semibold text-white">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-zinc-400">{step.body}</p>
                </div>

                <div className="mt-5 border-t border-edge bg-black/25 p-4">
                  {i === 0 && (
                    <div className="relative mx-auto aspect-[4/3] w-full max-w-[16rem] overflow-hidden rounded-xl bg-black/50">
                      {heroCard && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={heroCard.imageSmall} alt="" aria-hidden width={245} height={342} loading="lazy" decoding="async" className="absolute left-1/2 top-1/2 w-[46%] -translate-x-1/2 -translate-y-1/2 rotate-[-4deg] rounded-md opacity-90 shadow-xl" />
                      )}
                      <Brackets />
                      <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2 text-[11px] backdrop-blur">
                        <p className="text-zinc-200">Reading the name and number</p>
                        <p className="text-zinc-500">Matching the set · Pricing it</p>
                      </div>
                    </div>
                  )}
                  {i === 1 && market && quick && (
                    <div className="mx-auto max-w-[18rem] text-sm">
                      <div className="flex items-baseline justify-between">
                        <span className="text-zinc-500">Market price</span>
                        <span className="font-display text-lg font-semibold text-white">{formatMoney(market.base, market.price.currency)}</span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between text-xs">
                        <span className="text-zinc-500">Condition</span>
                        <span className="text-zinc-200">Near Mint</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-brand-400 bg-brand-500/15 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-brand-200">Quick sale</p>
                          <p className="font-display text-base font-semibold text-white">{money(quick.suggested)}</p>
                        </div>
                        <div className="rounded-lg border border-edge px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Full value</p>
                          <p className="font-display text-base font-semibold text-zinc-300">{money(market.suggested)}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-[11px] text-zinc-500">
                        You keep about{" "}
                        <span className="font-medium text-emerald-300">{money(Math.max(0, netAfterFees(quick.suggested) - POSTAGE_USD))}</span>{" "}
                        after eBay&apos;s cut and postage.
                      </p>
                    </div>
                  )}
                  {i === 2 && listing && featured && quick && (
                    <div className="mx-auto max-w-[18rem]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Generated listing</span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                          Ready to post
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium leading-snug text-white">{listing.title}</p>
                      <div className="mt-3 flex items-end justify-between border-t border-edge pt-3">
                        <span className="font-display text-xl font-semibold text-emerald-400">{money(quick.suggested)}</span>
                        <span className="rounded-full bg-ebay px-3 py-1.5 text-[11px] font-semibold text-white">Post to eBay</span>
                      </div>
                    </div>
                  )}
                  {i === 1 && !(market && quick) && <p className="text-center text-xs text-zinc-500">Live pricing for the exact printing.</p>}
                  {i === 2 && !(listing && featured) && <p className="text-center text-xs text-zinc-500">A finished eBay listing, written for you.</p>}
                </div>
              </div>
            ))}
          </div>
          {/* The full list lives on /features (10-02: the homepage keeps its one promise; the curious get one tap more). */}
          <div className="mt-5 flex justify-center">
            <Link href="/features" className="rounded-full border border-edge px-8 py-3.5 text-center text-sm font-semibold text-zinc-200 transition hover:-translate-y-0.5 hover:bg-surface-2">
              See Everything CardFlip Does
            </Link>
          </div>
        </section>

        {/* ============================ Games ============================== */}
        {/* One scanner, every game we read (09-30). Real cards from each
            game's own catalog with their live market price — the same card
            the scanner's empty stage shows for that game. Flat cards, no
            animated foil: the holo is rationed to the hero. A game with no
            priced card to show is left out rather than faked. */}
        {gameCards.length > 1 && (
          <section id="games" className="mx-auto w-full max-w-6xl px-6 pb-10 sm:pb-12">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Every game</p>
              <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-5xl">
                {gameCards.length === 5 ? "Five" : gameCards.length === 4 ? "Four" : gameCards.length === 3 ? "Three" : "Two"} games, one scanner.
              </h2>
              <p className="mt-3 max-w-prose leading-relaxed text-zinc-400">
                Flip the switch and the same camera reads {gameList(gameCards.map((s) => s.game))}. Each game keeps its own inventory, prices and listings.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {gameCards.map(({ game, card }) => (
                <div key={game} className="reveal flex flex-col rounded-3xl border border-edge bg-surface-1 p-3 last:odd:col-span-2 sm:last:odd:col-span-1">
                  <div className="mx-auto w-full max-w-[11rem]">
                    <HoloCard src={card.imageUrl} alt={`${card.name} — ${card.setName}`} className="aspect-[5/7] w-full" lazy />
                  </div>
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-brand-300">{GAMES[game].label}</span>
                    {card.price != null && <span className="font-display text-sm font-semibold text-white">{formatMoney(card.price)}</span>}
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-white">{card.name}</p>
                  <p className="truncate text-xs text-zinc-500">{card.setName}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ============================ Bento ============================== */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-10 sm:pb-12">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Built for the pile</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-5xl">
              Not one card. The whole binder.
            </h2>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-6">
            {/* Inventory */}
            <div className="reveal flex flex-col rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-3">
              <h3 className="font-display text-xl font-semibold text-white">Inventory that looks like a binder</h3>
              <p className="mt-2 max-w-prose leading-relaxed text-zinc-400">
                Every scan lands in your Inventory with its price, status and photo. Sort by
                value or rarity, file cards into categories, and see at a glance what&apos;s a
                draft, what&apos;s live on eBay, and what sold.
              </p>
              <CardWall cards={showcase} />
              {/* What the Inventory says about these eight, in the chart tile's four-number shape, so the two tiles
                  end level (Chris 10-02: "i hate empty space"). Statuses are the demo's, hence Example. */}
              {binder && (
                <dl className="mt-auto grid grid-cols-2 gap-2 pt-4">
                  {[
                    { label: "Cards", value: String(binder.count), sub: binder.games > 1 ? `Across ${binder.games} games` : "One game, one binder", tone: "text-white" },
                    { label: "Live on eBay", value: formatMoney(binder.liveValue), sub: "All 8, listed at market", tone: "text-emerald-300" },
                    { label: "Fees and Postage", value: `- ${formatMoney(binder.fees)}`, sub: "eBay’s cut on all 8", tone: "text-zinc-300" },
                    { label: "Sold", value: formatMoney(binder.soldValue), sub: "You keep when all 8 sell", tone: "text-sky-300" },
                  ].map((s) => (
                    <div key={s.label} className="min-w-0 rounded-xl border border-edge bg-black/25 px-3 py-2">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{s.label}</dt>
                      <dd className={`mt-0.5 truncate font-display text-base font-semibold tabular-nums ${s.tone}`}>{s.value}</dd>
                      <dd className="truncate text-[11px] text-zinc-500">{s.sub}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            {/* Price history */}
            <div className="reveal flex flex-col rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-3">
              <h3 className="font-display text-xl font-semibold text-white">Price history, per printing</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Our own daily record of the market, so you can see whether to sell now or sit on it.
              </p>
              {history.length >= 2 && featured ? (
                // The same chart the card pages draw (range pills, labelled ends), compact, in the tile.
                // No justify-end: on wide screens the binder tile is taller, and the slack used to open as a hole above the
                // card header (Chris 10-03: "whats up with this gap"). The stat tiles below take it instead.
                <div className="mt-4 flex flex-1 flex-col">
                  {/* The card the chart and the four stats belong to (Chris 10-02: feature the name so that is obvious). */}
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black/50 shadow-md shadow-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={featured.imageSmall || featured.imageLarge} alt="" aria-hidden width={245} height={342} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-display text-base font-semibold text-white">{featured.name}</p>
                      <p className="truncate text-xs text-zinc-400">{featured.setName}</p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <PriceHistoryChart cardId={featured.id} initialSeries={chartSeries} preferVariant={market?.price.variant ?? null} compact className="text-left" />
                  </div>
                  {/* What the record says, in four numbers (Chris 10-02: "fill the space properly, use something meaningful"). */}
                  <dl className="mt-3 grid flex-1 auto-rows-fr grid-cols-2 gap-2">
                    {historyStats(history).map((s) => (
                      <div key={s.label} className="flex flex-col justify-center rounded-xl border border-edge bg-black/25 px-3 py-2">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{s.label}</dt>
                        <dd className={`mt-0.5 font-display text-base font-semibold tabular-nums ${s.tone}`}>{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <p className="mt-5 text-xs text-zinc-600">History builds from the day a card is first priced.</p>
              )}
            </div>

            {/* From scan to sold: four Inventory rows, one per stage, full width under the wall and the chart (10-02). */}
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-6">
              <h3 className="font-display text-xl font-semibold text-white">From scan to sold</h3>
              <div className="mt-4">
                <DemoInventory cards={showcase} priceOf={marketOf} skip={8} />
              </div>
            </div>

            {/* Variants */}
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-2">
              <h3 className="font-display text-xl font-semibold text-white">Every variant, its own price</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Holo, reverse holo, 1st Edition, foil and etched are priced separately. Never averaged into a number that matches nothing.
              </p>
              {variantCard && variants.length > 0 && (
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black/50 shadow-md shadow-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={variantCard.imageSmall || variantCard.imageLarge} alt="" aria-hidden width={245} height={342} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{variantCard.name}</p>
                    <p className="truncate text-xs text-zinc-500">{variantCard.setName}</p>
                    <p className="text-[11px] text-zinc-500">{variants.length === 1 ? "One finish priced" : `${variants.length} finishes, ${variants.length} prices`}</p>
                  </div>
                </div>
              )}
              {variants.length > 0 && (
                <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-black/25 text-sm">
                  {variants.map((p) => (
                    <li key={`${p.source}-${p.variant}`} className="flex items-center justify-between px-3 py-2">
                      <span className="text-zinc-300">{p.label}</span>
                      <span className="font-display font-semibold text-white">{money(p.market!)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {variants.length > 1 && (
                <p className="mt-3 text-xs text-zinc-500">
                  <span className="font-semibold text-white">{money(Math.max(...variants.map((p) => p.market!)) - Math.min(...variants.map((p) => p.market!)))}</span>{" "}
                  between the dearest and cheapest finish of the same card. An averaged price would be wrong for both.
                </p>
              )}
            </div>

            {/* eBay */}
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-2">
              <h3 className="font-display text-xl font-semibold text-white">Your eBay, your money</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Listings publish under your own account. Change a price in CardFlip and the live listing changes with it. Sales flip to Sold on their own.
              </p>
              {/* The three sentences above, shown on one real card: listed, repriced in place, sold on its own
                  (Chris 10-02: the two bare status pills "seem a little weird"). Static, marked Example. */}
              {ebayDemo && (
                <figure className="mt-5 rounded-xl border border-edge bg-black/25 p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-black/50 shadow-md shadow-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ebayDemo.card.imageSmall || ebayDemo.card.imageLarge} alt="" aria-hidden width={245} height={342} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{ebayDemo.card.name}</p>
                      <p className="truncate text-xs text-zinc-500">{ebayDemo.card.setName}</p>
                    </div>
                    <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Example</p>
                  </div>
                  <ol className="mt-3 space-y-2 text-xs">
                    <li className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                        Live on eBay
                      </span>
                      <span className="font-display font-semibold tabular-nums text-white">{formatMoney(ebayDemo.listed)}</span>
                    </li>
                    <li className="flex items-center justify-between gap-3">
                      <span className="truncate text-zinc-400">Repriced here, eBay updated</span>
                      <span className="shrink-0 font-display font-semibold tabular-nums text-white">
                        <span className="mr-1.5 font-normal text-zinc-500 line-through">{formatMoney(ebayDemo.listed)}</span>
                        {formatMoney(ebayDemo.repriced)}
                      </span>
                    </li>
                    <li className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 rounded-full bg-sky-400/10 px-2.5 py-1 font-semibold text-sky-300">Sold</span>
                      <span className="font-display font-semibold tabular-nums text-white">{formatMoney(ebayDemo.repriced)}</span>
                    </li>
                  </ol>
                  <figcaption className="mt-2 text-[11px] text-zinc-500">Nothing to do on eBay. CardFlip did each step.</figcaption>
                </figure>
              )}
            </div>

            {/* Fees */}
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-2">
              <h3 className="font-display text-xl font-semibold text-white">Fee-aware pricing</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Every suggested price already has eBay&apos;s cut taken out: the {feePct} fee, the {money(EBAY_FLAT_FEE)} per-order charge ({money(EBAY_FLAT_FEE_OVER_10)} on a sale over ${EBAY_FLAT_FEE_STEP_USD}) and {money(POSTAGE_USD)} postage. A cheap card never lists at a loss.
              </p>
              <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
                {[
                  [feePct, "eBay fee"],
                  [money(EBAY_FLAT_FEE), "per order"],
                  [money(POSTAGE_USD), "postage"],
                ].map(([v, l]) => (
                  <div key={l} className="rounded-lg bg-black/30 px-2 py-2.5">
                    <dd className="font-display text-base font-semibold text-white">{v}</dd>
                    <dt className="text-[10px] text-zinc-500">{l}</dt>
                  </div>
                ))}
              </dl>
              {/* The same sale the eBay tile shows, taken apart, so the three numbers above mean something
                  (Chris 10-02: the fee tile ended short beside its neighbours). */}
              {ebayDemo && (
                <dl className="mt-3 rounded-xl border border-edge bg-black/25 px-3 py-2 text-xs">
                  {[
                    ["Sells for", formatMoney(ebayDemo.repriced), "text-white"],
                    ["eBay fee", `- ${formatMoney(ebayDemo.repriced * EBAY_FEE_RATE)}`, "text-zinc-300"],
                    ["Per order", `- ${formatMoney(ebayFlatFee(ebayDemo.repriced))}`, "text-zinc-300"],
                    ["Postage", `- ${formatMoney(POSTAGE_USD)}`, "text-zinc-300"],
                  ].map(([l, v, tone]) => (
                    <div key={l} className="flex items-center justify-between py-0.5">
                      <dt className="text-zinc-500">{l}</dt>
                      <dd className={`font-display font-semibold tabular-nums ${tone}`}>{v}</dd>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center justify-between border-t border-edge pt-1.5">
                    <dt className="font-medium text-zinc-300">You keep</dt>
                    <dd className="font-display text-sm font-semibold tabular-nums text-emerald-300">{formatMoney(Math.max(0, netAfterFees(ebayDemo.repriced) - POSTAGE_USD))}</dd>
                  </div>
                </dl>
              )}
            </div>
          </div>
        </section>

        {/* ============================ Pricing ============================= */}
        <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 pb-10 pt-2 sm:scroll-mt-20 sm:pb-12 sm:pt-4">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Pricing</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-5xl">Start free. Pay for the volume you need.</h2>
          </div>

          <PlanCard className="reveal mx-auto mt-6 max-w-6xl" />
          <p className="mt-4 text-center text-sm text-zinc-500">
            <Link href="/pricing" className="text-brand-300 hover:text-brand-200">
              What a scan is, and every billing question →
            </Link>
          </p>
        </section>

        {/* ============================== FAQ =============================== */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-10 sm:pb-12">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Questions</p>
          </div>
          <div className="reveal mx-auto mt-4 max-w-2xl divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-1">
            {faqs(games).map((faq) => (
              <details key={faq.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-white marker:content-none">
                  {faq.q}
                  <span className="shrink-0 text-zinc-500 transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* =========================== Final CTA ============================ */}
        <section className="relative py-12 sm:py-14">
          <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-4 px-6 text-center">
            <h2 className="reveal font-display text-4xl font-bold text-white sm:text-6xl">
              The binder isn&apos;t going
              <br />
              to sell itself.
            </h2>
            <p className="reveal max-w-md text-lg text-zinc-400">
              Scan the first card tonight and see what&apos;s actually in there.
            </p>
            <TrialCta className="reveal sheen rounded-full bg-brand-500 px-9 py-4 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:-translate-y-0.5 hover:bg-brand-400" />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
