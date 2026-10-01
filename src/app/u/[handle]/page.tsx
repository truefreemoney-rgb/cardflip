import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import { publicCollection } from "@/lib/server/publicCollection";
import { normalizeHandle } from "@/lib/handle";
import { formatMoney } from "@/lib/listing";
import { pageMetadata } from "@/lib/seo";

/**
 * cardflip.io/u/<handle> — a seller's public collection (Tier 2 #10).
 * Server-rendered, read-only, 404 when the handle is unknown OR the page is
 * switched off (indistinguishable on purpose). Every share is a landing
 * page: the cards, today's prices, Buy on eBay where a listing is live, and
 * one line about CardFlip at the bottom.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle: raw } = await params;
  const handle = normalizeHandle(raw);
  const c = handle ? await publicCollection(handle) : null;
  if (!c) return { title: "Collection", robots: { index: false } };
  const title = `@${c.handle}'s collection`;
  const description = `${c.count} card${c.count === 1 ? "" : "s"} worth ${formatMoney(c.value)} at today's prices${c.forSale ? `, ${c.forSale} for sale on eBay` : ""}. Tracked with CardFlip.`;
  // The shared helper, so this page keeps the site name and the twitter card; the first card's picture is its share image.
  return pageMetadata({ title, description, path: `/u/${handle}`, image: c.cards[0]?.imageUrl });
}

export default async function PublicCollectionPage({ params }: Params) {
  const { handle: raw } = await params;
  const handle = normalizeHandle(raw);
  const c = handle ? await publicCollection(handle) : null;
  if (!c) notFound();

  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Collection</p>
            <h1 className="mt-1 truncate font-display text-2xl font-semibold text-white sm:text-3xl">@{c.handle}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {c.count} card{c.count === 1 ? "" : "s"}
              {c.forSale ? ` · ${c.forSale} for sale on eBay` : ""}
              {c.truncated ? " · showing the top 500" : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Worth today</p>
            <p className="font-display text-2xl font-semibold tabular-nums text-emerald-300 sm:text-3xl">{formatMoney(c.value)}</p>
          </div>
        </header>

        {c.cards.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-edge bg-surface-1 px-4 py-10 text-center text-sm text-zinc-400">Nothing here yet.</p>
        ) : (
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {c.cards.map((card) => (
              <li key={card.id} className="flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface-1">
                <div className="relative aspect-[5/7] bg-black/30">
                  {card.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.imageUrl} alt={card.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                  {card.ebayUrl && (
                    <span className="absolute left-2 top-2 rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">For sale</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="truncate text-sm font-medium text-white">
                    {card.name}
                    {card.firstEdition ? <span className="ml-1 text-[10px] text-amber-300">1st Ed.</span> : null}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {card.setName}
                    {card.number ? ` · #${card.number}` : ""}
                    {card.kind === "card" ? ` · ${card.condition}` : ""}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <span className="font-display text-sm font-semibold tabular-nums text-white">{card.localPrice ?? (card.price != null ? formatMoney(card.price) : "—")}</span>
                    {card.ebayUrl && (
                      <a
                        href={card.ebayUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-400"
                      >
                        Buy on eBay
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-center text-xs text-zinc-500">
          Prices are today&apos;s market, tracked by{" "}
          <Link href="/" className="text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-white">
            CardFlip
          </Link>
          . Scan your own cards and get a page like this.
        </p>
      </main>
      <Footer />
    </div>
  );
}
