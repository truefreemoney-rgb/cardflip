import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import PlanCard, { PLAN, PRO } from "@/components/PlanCard";
import { EBAY_FEE_RATE, EBAY_FLAT_FEE, POSTAGE_USD } from "@/lib/fees";

export const metadata: Metadata = {
  title: "Pricing",
  description: "CardFlip is $9.99 a month: 500 scans, live pricing for the exact printing, and eBay listings written and published for you. Cancel any time.",
};

/**
 * /pricing — the one plan, spelled out. Same PlanCard as the landing page;
 * the extra here is what a scan is, what the month's allowance covers, and
 * the billing questions a paying seller actually asks. No tiers, no
 * comparison table, because there is nothing to compare.
 */

const covers = [
  { n: "1", label: "scan", body: "One photo, one card. Camera or upload. A re-scan of the same card counts again; searching by name or number is free." },
  { n: String(PLAN.scans), label: "scans a month", body: "That's 55 nine-pocket binder pages a month, or a few dozen cards a week with room to spare." },
  { n: "1st", label: "of the month", body: "The allowance resets on the first of each month. Unused scans don't roll over." },
];

const billing = [
  {
    q: "How does billing work?",
    a: "Stripe charges the card on file $9.99 each month from the day you subscribe. Invoices, card changes and cancellation are in Manage billing on your Account page.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Cancel from Manage billing and the plan runs to the end of the period you've paid for. Your cards, categories and watchlist stay on the account, and the app opens again the moment you resubscribe.",
  },
  {
    q: "What happens if I hit 500 scans?",
    a: "The scanner pauses until the first of the next month. Everything else keeps working: inventory, pricing you've already pulled, eBay listings, repricing and the watchlist.",
  },
  {
    q: "Does CardFlip take a cut of sales?",
    a: "No. Listings publish under your own eBay account and eBay pays you directly. CardFlip never touches the money. The only fees are eBay's, and every price CardFlip suggests already accounts for them.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes. Every new account gets 10 scans free with no card on file: scan, see live prices, build your inventory. Publishing to eBay starts with a subscription. When the free scans are used, the app asks you to subscribe; everything you scanned stays on the account.",
  },
  {
    q: "Do I need my own eBay account?",
    a: "Yes. You connect it once during signup, or later from your Account page.",
  },
  {
    q: "What's the difference between CardFlip and Pro?",
    a: "Only the scan cap: 500 a month on CardFlip, 2,000 on Pro. Pricing, eBay publishing, inventory and the watchlist are identical. Switch between them any time from Manage billing; the change takes effect on your next invoice.",
  },
];

export default function PricingPage() {
  const feePct = `${(EBAY_FEE_RATE * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MarketingNav />
      <main className="flex w-full flex-1 flex-col">
        <section className="hero-mesh grain relative overflow-hidden">
          <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto w-full max-w-6xl px-6 pb-8 pt-10 sm:pt-12">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Pricing</p>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-6xl">
                Start free. Pay for the volume you need.
              </h1>
              <p className="mt-4 text-lg text-zinc-400">
                Ten scans free to start. Then {PLAN.price} a month, or Pro at {PRO.price} when the binder outgrows it. Same product on both.
              </p>
            </div>
            <PlanCard className="mx-auto mt-6 max-w-6xl" />
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-12">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">What a scan is</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">500 goes a long way.</h2>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {covers.map((c) => (
              <div key={c.label} className="reveal rounded-3xl border border-edge bg-surface-1 p-6">
                <p className="font-display text-5xl font-bold text-white">
                  {c.n} <span className="text-lg font-semibold text-zinc-400">{c.label}</span>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-10 sm:pb-12">
          <div className="reveal grid gap-6 rounded-3xl border border-edge bg-surface-1 p-8 sm:grid-cols-[1fr_auto] sm:items-center sm:p-10">
            <div>
              <h2 className="font-display text-2xl font-semibold text-white">The only other fees are eBay&apos;s.</h2>
              <p className="mt-2 max-w-prose leading-relaxed text-zinc-400">
                CardFlip doesn&apos;t take a cut. Every suggested price already accounts for eBay&apos;s {feePct} final value fee, the {`$${EBAY_FLAT_FEE.toFixed(2)}`} per-order charge and {`$${POSTAGE_USD.toFixed(2)}`} postage, so a cheap card never lists at a loss and you can see what you&apos;ll keep before you post.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center sm:w-72">
              {[
                [feePct, "eBay fee"],
                [`$${EBAY_FLAT_FEE.toFixed(2)}`, "per order"],
                [`$${POSTAGE_USD.toFixed(2)}`, "postage"],
              ].map(([v, l]) => (
                <div key={l} className="rounded-xl bg-black/30 px-2 py-3">
                  <dd className="font-display text-lg font-semibold text-white">{v}</dd>
                  <dt className="text-[10px] text-zinc-500">{l}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-10 sm:pb-12">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Billing questions</p>
          </div>
          <div className="reveal mx-auto mt-4 max-w-2xl divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-1">
            {billing.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-white marker:content-none">
                  {f.q}
                  <span className="shrink-0 text-zinc-500 transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-5 text-center text-sm text-zinc-500">
            Something else?{" "}
            <Link href="/help" className="text-brand-300 hover:text-brand-200">
              Read the help center
            </Link>{" "}
            or email{" "}
            <a href="mailto:support@cardflip.io" className="text-brand-300 hover:text-brand-200">
              support@cardflip.io
            </a>
            .
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
