import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";
import CatalogSearch from "@/components/CatalogSearch";
import { gamePath, gameTitle } from "@/lib/cardPages";
import { GAME_IDS } from "@/lib/games";
import { PRIVATE_META } from "@/lib/pageMeta";

export const metadata = PRIVATE_META.notFound;

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MarketingNav />
      <main className="hero-mesh grain relative flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <p className="holo-text text-5xl font-bold">404</p>
        <h1 className="text-2xl font-semibold text-white">
          That page doesn&apos;t exist
        </h1>
        <p className="max-w-sm text-sm text-zinc-400">
          The card you&apos;re looking for isn&apos;t in this binder. Search for it
          or pick a game below.
        </p>
        <div className="w-full max-w-md">
          <CatalogSearch />
        </div>
        <ul className="flex max-w-md flex-wrap justify-center gap-2">
          {GAME_IDS.map((g) => (
            <li key={g}>
              <Link href={gamePath(g)} className="block rounded-full border border-edge bg-surface-1 px-4 py-2 text-sm text-zinc-200 transition hover:border-edge-strong">
                {gameTitle(g)}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/"
          className="mt-2 rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
        >
          Back to CardFlip
        </Link>
      </main>
      <Footer />
    </div>
  );
}
