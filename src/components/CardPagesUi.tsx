import Link from "next/link";
import ArtImg from "@/components/ArtImg";
import { PriceFlagText } from "@/components/PriceFlagNote";
import { cardPath } from "@/lib/cardPages";
import { formatMoney } from "@/lib/listing";
import type { GameId } from "@/lib/types";

/**
 * Small server-rendered pieces shared by the public card pages (/cards, SEO
 * sweep 09-30): breadcrumbs, the signup button, the price cell that never
 * prints a flagged number, and the tile grid. No client state: these pages
 * stay static.
 */

export function Crumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
      {items.map((it, i) => (
        <span key={`${i}-${it.name}`} className="flex items-center gap-x-1.5">
          {i > 0 && <span aria-hidden>/</span>}
          {it.href ? (
            <Link href={it.href} className="transition hover:text-zinc-300">
              {it.name}
            </Link>
          ) : (
            <span className="text-zinc-400">{it.name}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** The one ask on these pages. */
export function ScanCta({ label = "Scan Yours Free", className = "", secondary = false }: { label?: string; className?: string; secondary?: boolean }) {
  if (secondary) {
    return (
      <Link href="/signup" className={`inline-block rounded-full px-6 py-3 text-center text-sm font-semibold text-brand-300 transition hover:bg-white/5 hover:text-brand-200 ${className}`}>
        {label}
      </Link>
    );
  }
  return (
    <Link
      href="/signup"
      className={`sheen inline-block rounded-full bg-brand-500 px-7 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:-translate-y-0.5 hover:bg-brand-400 ${className}`}
    >
      {label}
    </Link>
  );
}

/** A price, or (flagged) the guard's sentence in its place. Never both. */
export function PriceCell({ price, flagged, className = "" }: { price: number | null; flagged: boolean; className?: string }) {
  if (flagged || price == null) return <PriceFlagText className={`text-xs ${className}`} />;
  return <span className={`font-display font-semibold tabular-nums text-emerald-300 ${className}`}>{formatMoney(price)}</span>;
}

/**
 * Phone-only bottom bar on a card page: today's price and the one button.
 * Solid background, safe-area padding, hidden from md up. The page's main
 * gets matching bottom padding so the footer is never covered.
 */
export function StickyPriceBar({ price, children }: { price: number | null; children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-edge-strong bg-[#0f1119] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      {price != null && (
        <div className="shrink-0 leading-tight">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">Market</p>
          <p className="font-display text-xl font-bold tabular-nums text-emerald-300">{formatMoney(price)}</p>
        </div>
      )}
      <div className="min-w-0 flex-1 [&>span]:w-full">{children}</div>
    </div>
  );
}

/** Bandwidth courtesy (optcgapi.com asks to go easy): its pictures are loaded one at a time on a card's own page, never in bulk on a list. */
export const showsInLists = (imageUrl: string): boolean => Boolean(imageUrl) && !/(^|\.)optcgapi\.com/.test(new URL(imageUrl, "https://x.invalid").hostname);

export interface TileData {
  key: string;
  name: string;
  number: string;
  image: string;
  price: number | null;
  flagged: boolean;
  setSlug: string;
  setName: string;
}

/** Cards as a grid of small pictures with name, set and price, each a link to its page. */
export function TileGrid({ game, tiles, showSet = false }: { game: GameId; tiles: TileData[]; showSet?: boolean }) {
  return (
    <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <li key={t.key} className="min-w-0">
          <Link
            href={cardPath(game, t.setSlug, t.name, t.key)}
            className="flex h-full flex-col overflow-hidden rounded-2xl border border-edge bg-surface-1 transition hover:border-edge-strong"
          >
            <div className="aspect-[5/7] bg-black/30">
              {showsInLists(t.image) && <ArtImg src={t.image} alt={`${t.name}, ${t.setName}`} loading="lazy" width={500} height={700} className="h-full w-full object-cover" />}
            </div>
            <div className="flex flex-1 flex-col gap-0.5 p-2.5">
              <p className="truncate text-sm font-medium text-white">{t.name}</p>
              <p className="truncate text-xs text-zinc-500">{showSet ? `${t.setName} · ${t.number}` : t.number}</p>
              <p className="mt-auto pt-1">
                <PriceCell price={t.price} flagged={t.flagged} />
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
