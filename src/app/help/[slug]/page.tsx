import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { helpArticles, helpArticlesFor, type HelpArticle } from "@/lib/helpArticles";
import { magicPublic } from "@/lib/server/settings";
import { helpArticleMetadata } from "@/lib/pageMeta";
import { breadcrumbGraph } from "@/lib/structuredData";

/**
 * One help article on its own page (SEO sweep 09-30): server-rendered, its own
 * title, description and canonical, a breadcrumb, and links to every other
 * topic. /help stays the index with the same text under the same anchors, so
 * in-app deep links (/help#scan-limits) keep working. The text is the one
 * source in lib/helpArticles.ts.
 */

export const revalidate = 86400;
export const generateStaticParams = async () => [];

const SLUG = /^[a-z0-9-]{1,40}$/;

/** The article for a slug, one read shared by generateMetadata and the page. The slug is checked against the static list before anything touches the database. */
const load = cache(async (slug: string): Promise<{ article: HelpArticle; all: HelpArticle[] } | null> => {
  if (!SLUG.test(slug) || !helpArticles.some((a) => a.id === slug)) return null;
  const all = helpArticlesFor(await magicPublic());
  const article = all.find((a) => a.id === slug);
  return article ? { article, all } : null;
});

export async function generateMetadata({ params }: PageProps<"/help/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const found = await load(slug);
  return found ? helpArticleMetadata(found.article) : { title: "Help" };
}

export default async function HelpArticlePage({ params }: PageProps<"/help/[slug]">) {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) notFound();
  const { article, all } = found;
  const others = all.filter((a) => a.id !== article.id);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <JsonLd
        data={breadcrumbGraph([
          { name: "CardFlip", path: "/" },
          { name: "Help", path: "/help" },
          { name: article.heading, path: `/help/${article.id}` },
        ])}
      />
      <MarketingNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 sm:py-16">
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500">
          <Link href="/help" className="transition hover:text-zinc-300">
            Help
          </Link>
          <span className="mx-1.5" aria-hidden>
            /
          </span>
          <span className="text-zinc-400">{article.heading}</span>
        </nav>

        <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">{article.heading}</h1>
        {article.paragraphs.map((text) => (
          <p key={text.slice(0, 40)} className="mt-4 text-sm leading-relaxed text-zinc-400">
            {text}
          </p>
        ))}
        <p className="mt-6 text-sm leading-relaxed text-zinc-400">
          Still stuck? Email{" "}
          <a href="mailto:support@cardflip.io" className="text-brand-300 transition hover:text-brand-200">
            support@cardflip.io
          </a>
          .
        </p>

        <nav aria-label="More help topics" className="mt-10 rounded-2xl border border-edge bg-surface-1 p-5">
          <h2 className="text-sm font-semibold text-white">More help topics</h2>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {others.map((a) => (
              <li key={a.id}>
                <Link href={`/help/${a.id}`} className="text-zinc-400 transition hover:text-zinc-200">
                  {a.heading}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            <Link href="/help" className="text-brand-300 transition hover:text-brand-200">
              All Help Topics
            </Link>
          </p>
        </nav>
      </main>

      <Footer />
    </div>
  );
}
