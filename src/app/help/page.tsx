import type { Metadata } from "next";
import { helpArticlesFor } from "@/lib/helpArticles";
import { magicPublic } from "@/lib/server/settings";
import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Help",
  description: "How CardFlip works — scanning, pricing, eBay listings, offers, and your account.",
};

/**
 * The help center: one page, one article per topic, each with a stable id so
 * error states and emails can deep-link straight to the answer
 * (e.g. /help#scan-limits). Voice per DESIGN.md: plain, confident, dry — and
 * like the legal pages this stays sober, no holo. Every claim here must match
 * what the product does today (data honesty); update the article when the
 * feature changes.
 */

export default async function HelpPage() {
  const articles = helpArticlesFor(await magicPublic());
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MarketingNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Help</h1>
        <p className="mt-6 text-sm leading-relaxed text-zinc-400">
          Everything CardFlip does, explained in the order you&apos;ll meet it.
          Can&apos;t find it here? Email{" "}
          <a href="mailto:support@cardflip.io" className="text-brand-300 transition hover:text-brand-200">
            support@cardflip.io
          </a>
          .
        </p>

        <nav aria-label="Help topics" className="mt-8 rounded-2xl border border-edge bg-surface-1 p-5">
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {articles.map((a) => (
              <li key={a.id}>
                <Link href={`#${a.id}`} className="text-zinc-400 transition hover:text-zinc-200">
                  {a.heading}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-12 space-y-12">
          {articles.map((article) => (
            <section key={article.id} id={article.id} className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-white">{article.heading}</h2>
              {article.paragraphs.map((text) => (
                <p key={text.slice(0, 40)} className="mt-3 text-sm leading-relaxed text-zinc-400">
                  {text}
                </p>
              ))}
            </section>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}
