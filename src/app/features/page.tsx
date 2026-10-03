import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import PlanCard from "@/components/PlanCard";
import TrialCta from "@/components/TrialCta";
import JsonLd from "@/components/JsonLd";
import { breadcrumbGraph } from "@/lib/structuredData";
import { PUBLIC_META } from "@/lib/pageMeta";
import { FEATURE_COUNT, FEATURE_FACTS, FEATURE_GROUPS } from "@/lib/features";
import { catalogSizeLabel } from "@/lib/server/catalogStats";

export const metadata = PUBLIC_META.features;
export const revalidate = 86400;

/**
 * /features — everything CardFlip does, on one page (Chris 10-02 night). The
 * homepage keeps its one promise and links here; the help page and the
 * footer link here; signed-in users reach it from Account. Four sections in
 * the order a seller meets them (Scan, Price, Track, Sell), one card per
 * feature, each with a plain sentence and a Try it link into the real screen.
 * The copy lives in lib/features.ts.
 */
export default async function FeaturesPage() {
  const catalogLabel = await catalogSizeLabel();
  const facts = [{ value: catalogLabel, label: "printings priced" }, ...FEATURE_FACTS];
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <JsonLd data={breadcrumbGraph([{ name: "CardFlip", path: "/" }, { name: "Features", path: "/features" }])} />
      <MarketingNav />
      <main className="flex w-full flex-1 flex-col">
        <section className="hero-mesh grain relative overflow-hidden">
          <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto w-full max-w-6xl px-6 pb-8 pt-10 sm:pt-12">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">Features</p>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-6xl">Everything CardFlip does.</h1>
              <p className="mt-4 text-lg text-zinc-400">
                Scan a card, know its price, track it, sell it. The {FEATURE_COUNT} pieces that do that, in the order you&apos;ll meet them.
              </p>
            </div>
            <nav aria-label="Sections" className="mt-6 flex flex-wrap justify-center gap-2">
              {FEATURE_GROUPS.map((g) => (
                <a key={g.id} href={`#${g.id}`} className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-300 transition hover:bg-surface-2 hover:text-white">
                  {g.label}
                </a>
              ))}
            </nav>
            <dl className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-2 text-center sm:grid-cols-5">
              {facts.map((f, i) => (
                // Five tiles in two phone columns: the last one spans the row, never a lone tile beside a hole.
                <div key={f.label} className={`rounded-xl border border-edge bg-surface-1/80 px-2 py-3 ${i === facts.length - 1 && facts.length % 2 ? "col-span-2 sm:col-span-1" : ""}`}>
                  <dd className="font-display text-lg font-semibold text-white">{f.value}</dd>
                  <dt className="text-[11px] text-zinc-500">{f.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {FEATURE_GROUPS.map((group, gi) => (
          <section key={group.id} id={group.id} className={`mx-auto w-full max-w-6xl scroll-mt-20 px-6 ${gi === 0 ? "pt-8 sm:pt-10" : "pt-10 sm:pt-12"} pb-2`}>
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-400">
                <span className="holo-text font-display text-base" aria-hidden>
                  {String(gi + 1).padStart(2, "0")}
                </span>{" "}
                {group.label}
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">{group.heading}</h2>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.features.map((f) => (
                <article key={f.title} className="reveal flex flex-col rounded-3xl border border-edge bg-surface-1 p-5">
                  <h3 className="font-display text-xl font-semibold text-white">{f.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-400">{f.body}</p>
                  <Link href={f.href} className="mt-4 inline-flex w-fit items-center gap-1 text-sm font-medium text-brand-300 transition hover:text-brand-200">
                    {f.cta ?? "Try it"} <span aria-hidden>→</span>
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ))}

        <section className="mx-auto w-full max-w-6xl px-6 pb-10 pt-10 sm:pb-12 sm:pt-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">All of it is in the free trial.</h2>
            <p className="mt-3 text-zinc-400">Scan, price and build your inventory before you pay anything. Publishing to eBay starts with a plan.</p>
            <TrialCta className="sheen mt-5 inline-block rounded-full bg-brand-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:-translate-y-0.5 hover:bg-brand-400" />
          </div>
          <PlanCard className="mx-auto mt-8 max-w-6xl" />
          <p className="mt-5 text-center text-sm text-zinc-500">
            Want the details?{" "}
            <Link href="/help" className="text-brand-300 hover:text-brand-200">
              Read the Help Center
            </Link>
            .
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
