import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import DemoButton from "@/components/DemoButton";
import HeroShowcase from "@/components/HeroShowcase";
import HoloCard from "@/components/HoloCard";
import PriceTicker from "@/components/PriceTicker";
import CardWall from "@/components/CardWall";
import { getFeaturedCard, getShowcaseCards } from "@/lib/tcg";
import { catalogSizeLabel } from "@/lib/server/catalogStats";
import { formatMoney, quotePrice } from "@/lib/listing";

const steps = [
  {
    title: "Scan the card",
    body: "Photograph the card — or drop in a whole stack. CardFlip reads the name and collector number straight off the image.",
  },
  {
    title: "Get the real price",
    body: "We match the exact printing and pull live TCGplayer market pricing, then adjust for the condition you pick.",
  },
  {
    title: "Post it",
    body: "Title, description and price are written for you. Review, then send it to eBay.",
  },
];

const features = [
  {
    title: "Scan a whole binder",
    body: "Queue up as many cards as you like. Each one is read, priced and written up while you keep scanning.",
  },
  {
    title: "Prices per printing",
    body: "Holo, reverse holo, 1st edition, foil and etched are priced separately — never averaged into a number that matches nothing.",
  },
  {
    title: "Built to sell fast",
    body: "Quick-sale pricing undercuts the market so cards actually move, or hold out for full value. Your call.",
  },
  {
    title: "Your eBay, your money",
    body: "Listings go up under your own account. You keep control, and you keep the payout.",
  },
];

const faqs = [
  {
    q: "Which cards does it work on?",
    a: "Any card in the Pokémon TCG catalog, from Base Set to the current sets, and every paper Magic: The Gathering printing from Alpha onward — switch the game in the scanner. If a scan doesn't match, you can search by name and pick the right printing in a couple of seconds.",
  },
  {
    q: "How accurate is the pricing?",
    a: "Prices come from live TCGplayer market data for the exact printing, then get adjusted for the condition you select. Condition multipliers are estimates to anchor your listing, not a formal appraisal.",
  },
  {
    q: "Do I need my own eBay account?",
    a: "Yes. CardFlip creates the listing content and hands it to eBay under your account, so payouts and buyer messages come straight to you.",
  },
  {
    q: "What does it cost?",
    a: "CardFlip will be $4.99/month for everything — unlimited scans, AI card reading, live pricing, and listing tracking. It's free while we're in early access, and early-access sellers will be told well before billing starts. You always keep 100% of your eBay payouts.",
  },
];

// Render at request time: the card mirror lives on the Fly volume, which
// doesn't exist in the Docker builder — a build-time prerender can bake an
// empty ticker/hero into the page for up to a revalidation window.
// (Fetches keep their own data cache; this only moves rendering to runtime.)
export const dynamic = "force-dynamic";

export default async function Home() {
  const [featured, showcase] = await Promise.all([
    getFeaturedCard(),
    getShowcaseCards(),
  ]);
  const catalogLabel = catalogSizeLabel();

  // Hero card falls back to a mirror showcase card when the price API is
  // down — the price chip hides itself, but the 3D card never disappears.
  // The "What comes out" listing demo still requires a genuinely priced
  // card, so it keeps gating on `featured` alone.
  const heroCard = featured ?? showcase[0] ?? null;
  const heroQuote = heroCard
    ? quotePrice(heroCard, "Near Mint", "market")
    : null;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MarketingNav />

      <main className="flex w-full flex-1 flex-col">
        {/* ============================== Hero ============================== */}
        <section className="hero-mesh aurora grain relative overflow-hidden">
          <div
            className="dot-grid pointer-events-none absolute inset-0"
            aria-hidden
          />

          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-14 px-6 pb-20 pt-20 sm:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8">
            <div className="flex flex-col items-start gap-6 text-left">
              <div className="animate-fade-up foil-edge inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-zinc-200">
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="animate-pulse-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Early access · free while in beta
              </div>

              <h1
                className="animate-fade-up font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl"
                style={{ animationDelay: "60ms" }}
              >
                Your binder is
                <br />
                <span className="holo-text">worth money.</span>
                <br />
                Flip it.
              </h1>

              <p
                className="animate-fade-up max-w-md text-lg leading-relaxed text-zinc-400"
                style={{ animationDelay: "120ms" }}
              >
                Scanning a card takes a second. Pricing it, writing the listing
                and getting it online takes ten minutes. CardFlip does the
                other nine.
              </p>

              <div
                className="animate-fade-up flex flex-col gap-3 sm:flex-row"
                style={{ animationDelay: "180ms" }}
              >
                <Link
                  href="/signup"
                  className="sheen rounded-full bg-brand-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:-translate-y-0.5 hover:bg-brand-400"
                >
                  Start selling free
                </Link>
                <DemoButton />
              </div>

              <dl
                className="animate-fade-up mt-4 flex flex-wrap gap-x-8 gap-y-3"
                style={{ animationDelay: "240ms" }}
              >
                {[
                  [catalogLabel, "printings in the catalog"],
                  ["Every printing", "priced separately"],
                  ["100%", "of the payout is yours"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dd className="font-display text-lg font-semibold text-white">
                      {value}
                    </dd>
                    <dt className="text-xs text-zinc-500">{label}</dt>
                  </div>
                ))}
              </dl>
            </div>

            {heroCard && (
              <div
                className="animate-fade-up relative mx-auto w-64 sm:w-72"
                style={{ animationDelay: "150ms" }}
              >
                <div
                  className="absolute -inset-10 rounded-full bg-[conic-gradient(from_140deg,rgba(125,211,252,0.22),rgba(167,139,250,0.28),rgba(240,171,252,0.22),rgba(252,211,77,0.14),rgba(125,211,252,0.22))] blur-3xl"
                  aria-hidden
                />
                <HoloCard
                  src={heroCard.imageLarge || heroCard.imageSmall}
                  alt={`${heroCard.name} — ${heroCard.setName}`}
                />
                {heroQuote && (
                  <div className="foil-edge absolute -bottom-4 left-1/2 flex -translate-x-1/2 items-baseline gap-2 whitespace-nowrap rounded-full px-4 py-2 shadow-xl shadow-black/50">
                    <span className="text-xs text-zinc-400">
                      {heroCard.name}
                    </span>
                    <span className="font-display text-sm font-bold text-emerald-400">
                      {formatMoney(heroQuote.base, heroQuote.price.currency)}
                    </span>
                  </div>
                )}
                <p className="mt-8 text-center text-[11px] text-zinc-500">
                  Real card, live market price. Move your cursor over it.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ======================== Live price ticker ======================= */}
        <PriceTicker cards={showcase} catalogLabel={catalogLabel} />

        {/* =========================== How it works ========================= */}
        <section
          id="how-it-works"
          className="mx-auto w-full max-w-5xl scroll-mt-20 px-6 py-24"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">
            How it works
          </p>
          <div className="mt-10 flex flex-col">
            {steps.map((step, i) => (
              <div
                key={step.title}
                className="reveal grid items-start gap-4 border-t border-white/5 py-10 first:border-t-0 sm:grid-cols-[8rem_1fr] sm:gap-10"
              >
                <div
                  className="holo-text font-display text-7xl font-bold opacity-70 sm:text-8xl"
                  aria-hidden
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="max-w-xl">
                  <h3 className="font-display text-2xl font-semibold text-white sm:text-3xl">
                    {step.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-zinc-400">
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ========================== Real output =========================== */}
        {featured && (
          <section className="mx-auto w-full max-w-6xl px-6 pb-24">
            <p className="reveal text-center text-sm font-semibold uppercase tracking-widest text-brand-400">
              What comes out
            </p>
            <div className="reveal mt-8">
              <HeroShowcase card={featured} />
            </div>
            <p className="mt-6 text-center text-xs text-zinc-500">
              Real example — an actual card, priced from live TCGplayer market
              data by CardFlip.
            </p>
          </section>
        )}

        {/* ============================ Features ============================ */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <p className="reveal text-sm font-semibold uppercase tracking-widest text-brand-400">
            Why CardFlip
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="reveal sheen rounded-3xl border border-edge bg-surface-1 p-7 transition hover:border-edge-strong hover:bg-surface-2 sm:col-span-2 lg:row-span-2">
              <h3 className="font-display text-xl font-semibold text-white">
                {features[0].title}
              </h3>
              <p className="mt-3 leading-relaxed text-zinc-400">
                {features[0].body}
              </p>
              <CardWall cards={showcase} />
            </div>
            {features.slice(1).map((f) => (
              <div
                key={f.title}
                className="reveal sheen rounded-3xl border border-edge bg-surface-1 p-7 transition hover:border-edge-strong hover:bg-surface-2 sm:col-span-1 lg:col-span-2"
              >
                <h3 className="font-display text-xl font-semibold text-white">
                  {f.title}
                </h3>
                <p className="mt-3 max-w-prose leading-relaxed text-zinc-400">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ============================ Pricing ============================= */}
        <section
          id="pricing"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-16"
        >
          <p className="reveal text-center text-sm font-semibold uppercase tracking-widest text-brand-400">
            Pricing
          </p>
          <div className="reveal foil-edge-live relative mx-auto mt-8 max-w-md overflow-hidden rounded-3xl p-8">
            <div
              className="pointer-events-none absolute right-0 top-0 h-40 w-40 translate-x-1/3 -translate-y-1/3 rounded-full bg-brand-500/20 blur-3xl"
              aria-hidden
            />
            <div className="relative">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-lg font-semibold text-white">
                  Everything, one plan
                </h3>
                <p className="text-right">
                  <span className="holo-text font-display text-4xl font-bold">
                    $4.99
                  </span>
                  <span className="text-sm text-zinc-500">/month</span>
                </p>
              </div>

              <ul className="mt-6 space-y-3 text-sm text-zinc-300">
                {[
                  "Unlimited card scans — camera or photos",
                  "AI card reading with condition grading",
                  "Live TCGplayer market pricing for the exact printing",
                  "eBay listings written and pre-filled for you",
                  "Every card tracked from draft to listed to sold",
                  "Wishlist and price-check tools",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-emerald-400" aria-hidden>
                      ✓
                    </span>
                    {line}
                  </li>
                ))}
              </ul>

              <div className="mt-7 flex flex-col items-center gap-3">
                <Link
                  href="/signup"
                  className="sheen w-full rounded-full bg-brand-500 px-7 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
                >
                  Join free in early access
                </Link>
                <p className="text-xs text-zinc-500">
                  Free during early access — no card required. You&apos;ll get
                  notice before billing ever starts.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ============================== FAQ =============================== */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <p className="reveal text-center text-sm font-semibold uppercase tracking-widest text-brand-400">
            Questions
          </p>
          <div className="reveal mx-auto mt-8 max-w-2xl divide-y divide-white/5 overflow-hidden rounded-2xl border border-edge bg-surface-1">
            {faqs.map((faq) => (
              <details key={faq.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-white marker:content-none">
                  {faq.q}
                  <span
                    className="shrink-0 text-zinc-500 transition-transform group-open:rotate-45"
                    aria-hidden
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* =========================== Final CTA ============================ */}
        <section className="hero-mesh aurora grain relative mt-8 overflow-hidden py-24">
          <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 text-center">
            <h2 className="reveal font-display text-4xl font-bold text-white sm:text-6xl">
              Ready to clear out
              <br />
              <span className="holo-text">your binder?</span>
            </h2>
            <p className="reveal text-lg text-zinc-400">
              Create your free account and start listing in minutes.
            </p>
            <Link
              href="/signup"
              className="reveal sheen rounded-full bg-brand-500 px-9 py-4 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:-translate-y-0.5 hover:bg-brand-400"
            >
              Get started
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
