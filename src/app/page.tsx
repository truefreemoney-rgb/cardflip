import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import HoloCard from "@/components/HoloCard";
import CardWall from "@/components/CardWall";
import PlanCard from "@/components/PlanCard";
import { getFeaturedCard, getShowcaseCards } from "@/lib/tcg";
import { catalogSizeLabel } from "@/lib/server/catalogStats";
import { getPriceHistory } from "@/lib/server/priceHistory";
import { buildListing, formatMoney, plausiblePrices, quotePrice } from "@/lib/listing";
import { EBAY_FEE_RATE, EBAY_FLAT_FEE, POSTAGE_USD, netAfterFees } from "@/lib/fees";
import type { PokemonCard } from "@/lib/types";

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

const faqs = [
  {
    q: "Which cards does it work on?",
    a: "Any English card in the Pokémon TCG catalog, from Base Set to the current sets, and every paper Magic: The Gathering printing from Alpha onward. Switch the game in the scanner. Japanese and Chinese support is built and will be switched on later.",
  },
  {
    q: "What if the scan picks the wrong printing?",
    a: "Every card shows its match beside your photo, with a \"Not your card?\" list of every printing that shares the name. Tap the right one and the price, title and listing follow it. Verification is one tap and it's remembered.",
  },
  {
    q: "Where do the prices come from?",
    a: "The TCGplayer market price for the exact printing and variant, adjusted for the condition you pick, with live eBay asking prices as a reference. Cards under a few dollars get a fee-aware floor so a listing never loses money on eBay's cut and postage.",
  },
  {
    q: "Do I need my own eBay account?",
    a: "Yes. You connect it once. CardFlip writes the listing and publishes it under your account, so payouts and buyer messages come straight to you. Change the price in CardFlip and the live listing updates in place.",
  },
  {
    q: "Does it work on my phone?",
    a: "Yes. CardFlip runs in Safari or Chrome, and on iPhone you can add it to the home screen for a full-screen scanner. The camera is the fastest way in, but you can also upload photos or search by name.",
  },
  {
    q: "What does it cost?",
    a: "Your first 10 scans are free, no card needed: scan, price, build your inventory. Publishing to eBay starts with a subscription, $9.99 a month for 500 scans, live pricing, eBay publishing, inventory and the watchlist. Cancel any time. You keep 100% of every eBay payout.",
  },
];

const steps = [
  {
    title: "Point the camera",
    body: "Fill the frame, tap Capture. CardFlip reads the name and collector number off the photo, and the 1st Edition stamp when there is one.",
  },
  {
    title: "Get the real price",
    body: "It matches the exact printing, pulls the live TCGplayer market price for that variant, and adjusts for the condition you pick. Quick sale or full value, your call.",
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

/** Our own recorded TCGplayer history for the featured card, as an SVG path. */
function Sparkline({ points }: { points: { day: string; price: number }[] }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 96;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const xs = points.map((_, i) => (i / (points.length - 1)) * w);
  const ys = prices.map((p) => h - 8 - ((p - min) / span) * (h - 16));
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1];
  const first = points[0];
  const delta = last.price - first.price;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-2xl font-semibold text-white">{money(last.price)}</span>
        <span className={`text-xs font-medium ${delta >= 0 ? "text-emerald-400" : "text-rose-300"}`}>
          {delta >= 0 ? "▲" : "▼"} {money(Math.abs(delta))} over {points.length} days
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-24 w-full" aria-hidden preserveAspectRatio="none">
        <defs>
          <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#a78bfa" stopOpacity="0.35" />
            <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-fill)" />
        <path d={d} fill="none" stroke="#c4b5fd" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3.5" fill="#f0abfc" />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-600">
        <span>{first.day.slice(5)}</span>
        <span>{last.day.slice(5)}</span>
      </div>
    </div>
  );
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

export default async function Home() {
  const [featured, showcase, catalogLabel] = await Promise.all([
    getFeaturedCard(),
    getShowcaseCards(),
    catalogSizeLabel(),
  ]);

  const heroCard = featured ?? showcase[0] ?? null;
  const market = heroCard ? quotePrice(heroCard, "Near Mint", "market") : null;
  const quick = heroCard ? quotePrice(heroCard, "Near Mint", "quick") : null;
  const listing =
    featured && quick ? buildListing(featured, quick.suggested, "Near Mint", quick.price.label) : null;
  const variants = featured ? plausiblePrices(featured.prices).filter((p) => p.market).slice(0, 4) : [];

  // Our own recorded history for the hero card — the last 90 points of the
  // variant the quote is based on (falls back to the longest USD series).
  let history: { day: string; price: number }[] = [];
  if (featured) {
    try {
      const series = await getPriceHistory(featured.id);
      const usd = series.filter((s) => s.currency === "USD" && s.source === "tcgplayer");
      const pick =
        usd.find((s) => s.variant === market?.price.variant) ??
        usd.slice().sort((a, b) => b.points.length - a.points.length)[0];
      history = pick ? pick.points.slice(-90) : [];
    } catch {
      history = [];
    }
  }

  const feePct = `${(EBAY_FEE_RATE * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MarketingNav />

      <main className="flex w-full flex-1 flex-col">
        {/* ============================== Hero ============================== */}
        {/* Seamless (Chris, 09-04): no section backgrounds on this page — the
            body ambient is the only ground, so there is nothing to transition
            between. The only local light is the glow behind the phone.
            overflow-x-clip, not overflow-hidden: hidden clipped the phone's
            blurred glow at the section's bottom edge — a hard line across
            the page (Chris, twice: "it's supposed to flow together"). */}
        <section className="relative overflow-x-clip">
          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-8 px-6 pb-6 pt-10 sm:pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:pb-8">
            <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
              <div className="animate-fade-up foil-edge inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-zinc-200">
                Pokémon TCG · Magic: The Gathering
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
                <Link
                  href="/signup"
                  className="sheen rounded-full bg-brand-500 px-8 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:-translate-y-0.5 hover:bg-brand-400"
                >
                  Try 10 scans free
                </Link>
                <a
                  href="#how-it-works"
                  className="rounded-full border border-edge px-8 py-3.5 text-center text-sm font-semibold text-zinc-200 transition hover:-translate-y-0.5 hover:bg-surface-2"
                >
                  See how it works
                </a>
              </div>

              <ul className="animate-fade-up mt-2 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-zinc-500 sm:justify-start" style={{ animationDelay: "240ms" }}>
                {[
                  `${catalogLabel} printings, each priced on its own`,
                  "TCGplayer market plus live eBay comps",
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
                <div
                  className="absolute -inset-10 rounded-full bg-[conic-gradient(from_140deg,rgba(125,211,252,0.35),rgba(167,139,250,0.45),rgba(240,171,252,0.35),rgba(252,211,77,0.22),rgba(125,211,252,0.35))] blur-3xl"
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
                      <HoloCard src={heroCard.imageLarge || heroCard.imageSmall} alt={`${heroCard.name} — ${heroCard.setName}`} className="h-full w-full" />
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
                          <span className="text-[10px] text-zinc-500">TCGplayer market · {market.price.label}</span>
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
                  <span className="hidden sm:inline"> Move your cursor over it.</span>
                </p>
              </div>
            )}
          </div>
        </section>

        {/* =========================== How it works ========================= */}
        <section id="how-it-works" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 pb-10 pt-6 sm:pb-12 sm:pt-8">
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
                        <img src={heroCard.imageSmall} alt="" aria-hidden className="absolute left-1/2 top-1/2 w-[46%] -translate-x-1/2 -translate-y-1/2 rotate-[-4deg] rounded-md opacity-90 shadow-xl" />
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
                        <span className="text-zinc-500">TCGplayer market</span>
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
        </section>

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
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-4">
              <h3 className="font-display text-xl font-semibold text-white">Inventory that looks like a binder</h3>
              <p className="mt-2 max-w-prose leading-relaxed text-zinc-400">
                Every scan lands in your Inventory with its price, status and photo. Sort by
                value or rarity, file cards into categories, and see at a glance what&apos;s a
                draft, what&apos;s live on eBay, and what sold.
              </p>
              <CardWall cards={showcase} />
              {showcase.length >= 4 && (
                <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {showcase.slice(0, 4).map((c) => {
                    const m = marketOf(c);
                    return (
                      <li key={c.id} className="flex items-baseline justify-between gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs">
                        <span className="truncate text-zinc-300">{c.name}</span>
                        {m !== null && <span className="shrink-0 font-display font-semibold text-white">{money(m)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Price history */}
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-2">
              <h3 className="font-display text-xl font-semibold text-white">Price history, per printing</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Our own daily record of the market, so you can see whether to sell now or sit on it.
              </p>
              {history.length >= 2 ? (
                <div className="mt-5">
                  <p className="truncate text-xs text-zinc-500">
                    {featured?.name} · {featured?.setName}
                  </p>
                  <div className="mt-1">
                    <Sparkline points={history} />
                  </div>
                </div>
              ) : (
                <p className="mt-5 text-xs text-zinc-600">History builds from the day a card is first priced.</p>
              )}
            </div>

            {/* Variants */}
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-2">
              <h3 className="font-display text-xl font-semibold text-white">Every variant, its own price</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Holo, reverse holo, 1st Edition, foil and etched are priced separately. Never averaged into a number that matches nothing.
              </p>
              {variants.length > 0 && (
                <ul className="mt-5 divide-y divide-edge rounded-xl border border-edge bg-black/25 text-sm">
                  {variants.map((p) => (
                    <li key={`${p.source}-${p.variant}`} className="flex items-center justify-between px-3 py-2">
                      <span className="text-zinc-300">{p.label}</span>
                      <span className="font-display font-semibold text-white">{money(p.market!)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* eBay */}
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-2">
              <h3 className="font-display text-xl font-semibold text-white">Your eBay, your money</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Listings publish under your own account. Change a price in CardFlip and the live listing changes with it. Sales flip to Sold on their own.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <span className="inline-flex items-center gap-2 self-start rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                  Live on eBay
                </span>
                <span className="inline-flex items-center gap-2 self-start rounded-full bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-300">Sold</span>
              </div>
            </div>

            {/* Fees */}
            <div className="reveal rounded-3xl border border-edge bg-surface-1 p-6 md:col-span-2">
              <h3 className="font-display text-xl font-semibold text-white">Fee-aware pricing</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Every suggestion accounts for eBay&apos;s {feePct} plus {money(EBAY_FLAT_FEE)} per order and {money(POSTAGE_USD)} postage, so a cheap card never lists at a loss.
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
            </div>
          </div>
        </section>

        {/* ============================ Pricing ============================= */}
        <section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 pb-10 pt-2 sm:pb-12 sm:pt-4">
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
            {faqs.map((faq) => (
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
            <Link
              href="/signup"
              className="reveal sheen rounded-full bg-brand-500 px-9 py-4 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:-translate-y-0.5 hover:bg-brand-400"
            >
              Try 10 scans free
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
