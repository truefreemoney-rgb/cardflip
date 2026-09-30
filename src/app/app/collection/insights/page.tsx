"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageSkeleton from "@/components/PageSkeleton";
import GameToggle from "@/components/GameToggle";
import InventoryValueChart from "@/components/InventoryValueChart";
import { useSession } from "@/components/SessionProvider";
import { apiPath } from "@/lib/client/basePath";
import { formatMoney } from "@/lib/listing";
import { readSavedGame, saveGame } from "@/lib/games";
import type { GameId } from "@/lib/types";

/**
 * Collection insights (Tier 3 #17, 09-28): the portfolio view of what the
 * seller holds — value and its 7/30-day move, this week's movers, the top
 * ten, value by set, and how much is listed versus sitting. One scrolling
 * stack of panels on a phone. Data: /api/cards/insights.
 */

interface InsightCard {
  id: string;
  name: string;
  setName: string;
  imageUrl: string;
  kind: "card" | "sealed";
  quantity: number;
  price: number;
  weekAgo: number | null;
}
interface Mover extends InsightCard {
  delta: number;
  pct: number;
}
interface Bucket {
  name: string;
  value: number;
  count: number;
}
interface Slice {
  count: number;
  value: number;
}
interface Insights {
  game: GameId;
  holding: number;
  value: { now: number; weekAgo: number | null; monthAgo: number | null };
  gainers: Mover[];
  losers: Mover[];
  top: (InsightCard & { share: number })[];
  bySet: Bucket[];
  split: { live: Slice; draft: Slice; ended: Slice; sold: Slice };
  unlistedVerified: Slice;
  leftOut?: number;
}

const panel = "overflow-hidden rounded-2xl border border-edge bg-surface-1";
const heading = "text-[10px] font-semibold uppercase tracking-wide text-zinc-500";

function Change({ now, then, label }: { now: number; then: number | null; label: string }) {
  if (then == null || !(then > 0)) {
    return (
      <div>
        <div className={heading}>{label}</div>
        <div className="mt-0.5 text-sm text-zinc-500">Not enough history yet</div>
      </div>
    );
  }
  const delta = now - then;
  const pct = (delta / then) * 100;
  const flat = Math.abs(delta) < 0.005;
  const tone = flat ? "text-zinc-400" : delta > 0 ? "text-emerald-400" : "text-rose-400";
  return (
    <div>
      <div className={heading}>{label}</div>
      <div className={`mt-0.5 font-display text-base font-semibold ${tone}`}>
        {flat ? "Unchanged" : `${delta > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(delta))}`}
        {!flat && <span className="ml-1 text-xs font-medium opacity-80">({Math.abs(pct).toFixed(1)}%)</span>}
      </div>
    </div>
  );
}

function Thumb({ card, className = "" }: { card: InsightCard; className?: string }) {
  return card.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={card.imageUrl}
      alt=""
      className={`h-14 w-10 shrink-0 rounded-md bg-black/40 ${card.kind === "sealed" ? "object-contain" : "object-cover"} ${className}`}
    />
  ) : (
    <div className={`h-14 w-10 shrink-0 rounded-md bg-black/40 ${className}`} />
  );
}

function MoverRow({ card }: { card: Mover }) {
  const up = card.delta > 0;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Thumb card={card} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100">{card.name}</p>
        <p className="truncate text-xs text-zinc-500">{card.setName}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-display text-sm font-semibold text-white">{formatMoney(card.price)}</p>
        <p className={`text-xs font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>
          {up ? "▲" : "▼"} {formatMoney(Math.abs(card.delta))} · {Math.abs(card.pct).toFixed(0)}%
        </p>
      </div>
    </li>
  );
}

export default function InsightsPage() {
  const { status } = useSession();
  const [game, setGame] = useState<GameId>(() => readSavedGame());
  // The result remembers which game it is for, so switching games shows the
  // skeleton until the new one lands without a synchronous reset.
  const [result, setResult] = useState<{ game: GameId; data: Insights | null } | null>(null);

  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    void fetch(apiPath(`/api/cards/insights?game=${game}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Insights) => {
        if (live) setResult({ game, data: j });
      })
      .catch(() => {
        if (live) setResult({ game, data: null });
      });
    return () => {
      live = false;
    };
  }, [status, game]);

  if (status !== "ready" || !result || result.game !== game) return <PageSkeleton />;
  const data = result.data;
  const failed = data === null;

  const empty = data && data.holding <= 0 && data.split.sold.count === 0;
  const maxSet = data ? Math.max(1, ...data.bySet.map((b) => b.value)) : 1;
  const splitTotal = data ? data.split.live.value + data.split.draft.value + data.split.ended.value : 0;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/app/collection" className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
            ← Inventory
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold text-white">Insights</h1>
          <p className="mt-1 text-sm text-zinc-500">What you hold, what moved this week, and what is sitting unlisted.</p>
        </div>
        <GameToggle
          game={game}
          compact
          onChange={(g) => {
            saveGame(g);
            setGame(g);
          }}
        />
      </div>

      {failed || !data ? (
        <p className="rounded-xl border border-edge bg-surface-1 px-4 py-3 text-sm text-zinc-400">Couldn&apos;t load insights. Pull to refresh or try again in a minute.</p>
      ) : empty ? (
        <div className={`${panel} px-4 py-8 text-center`}>
          <p className="text-sm font-medium text-zinc-200">Nothing to chart yet</p>
          <p className="mt-1 text-sm text-zinc-500">Scan a few cards and this page fills in with their value, movers and sets.</p>
          <Link href="/app" className="mt-4 inline-flex rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400">
            Open the Scanner
          </Link>
        </div>
      ) : (
        <>
          {/* Value hero: the one showpiece number on the page. */}
          <section className={panel}>
            <div className="px-4 pb-3 pt-4 sm:px-5">
              <div className={heading}>Collection value</div>
              <div className="mt-0.5 font-display text-4xl font-bold tracking-tight text-white">{formatMoney(data.holding)}</div>
              <p className="mt-1 text-xs text-zinc-500">
                Asking price of every unsold copy at today&apos;s market, {data.split.live.count + data.split.draft.count + data.split.ended.count} copies.
              </p>
              {(data.leftOut ?? 0) > 0 && (
                <p className="mt-1 text-xs text-amber-300">
                  {data.leftOut} {data.leftOut === 1 ? "card" : "cards"} left out, {data.leftOut === 1 ? "its price looks" : "their prices look"} off.
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Change now={data.value.now} then={data.value.weekAgo} label="Past 7 days" />
                <Change now={data.value.now} then={data.value.monthAgo} label="Past 30 days" />
              </div>
            </div>
            <InventoryValueChart game={game} className="border-t border-edge" />
          </section>

          {/* Movers this week */}
          <section className={panel}>
            <div className="border-b border-edge px-4 py-3 sm:px-5">
              <h2 className={heading}>Movers this week</h2>
            </div>
            {data.gainers.length === 0 && data.losers.length === 0 ? (
              <p className="px-4 py-4 text-sm text-zinc-500">No card moved more than a few cents in the past week.</p>
            ) : (
              <div className="grid gap-px bg-edge sm:grid-cols-2">
                <div className="bg-surface-1">
                  <p className="px-4 pt-3 text-xs font-semibold text-emerald-400">Up</p>
                  {data.gainers.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-zinc-500">Nothing up this week.</p>
                  ) : (
                    <ul className="divide-y divide-edge">{data.gainers.map((c) => <MoverRow key={c.id} card={c} />)}</ul>
                  )}
                </div>
                <div className="bg-surface-1">
                  <p className="px-4 pt-3 text-xs font-semibold text-rose-400">Down</p>
                  {data.losers.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-zinc-500">Nothing down this week.</p>
                  ) : (
                    <ul className="divide-y divide-edge">{data.losers.map((c) => <MoverRow key={c.id} card={c} />)}</ul>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Listed vs sitting */}
          <section className={panel}>
            <div className="border-b border-edge px-4 py-3 sm:px-5">
              <h2 className={heading}>Listed vs sitting</h2>
            </div>
            <div className="px-4 py-4 sm:px-5">
              {splitTotal > 0 && (
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/40">
                  <div className="bg-emerald-400" style={{ width: `${(data.split.live.value / splitTotal) * 100}%` }} />
                  <div className="bg-brand-400" style={{ width: `${(data.split.draft.value / splitTotal) * 100}%` }} />
                  <div className="bg-amber-400" style={{ width: `${(data.split.ended.value / splitTotal) * 100}%` }} />
                </div>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {(
                  [
                    ["Live on eBay", data.split.live, "bg-emerald-400"],
                    ["Drafts", data.split.draft, "bg-brand-400"],
                    ["Ended, unsold", data.split.ended, "bg-amber-400"],
                    ["Sold", data.split.sold, "bg-sky-400"],
                  ] as [string, Slice, string][]
                ).map(([label, s, dot]) => (
                  <div key={label} className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> {label}
                    </dt>
                    <dd className="font-display text-base font-semibold text-white">
                      {formatMoney(s.value)} <span className="text-xs font-medium text-zinc-500">· {s.count}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {/* No "drafts not listed" nudge here (Chris, 09-28: "i dont think we need that"). */}
            </div>
          </section>

          {/* Top 10 */}
          <section className={panel}>
            <div className="border-b border-edge px-4 py-3 sm:px-5">
              <h2 className={heading}>Your most valuable</h2>
            </div>
            <ol className="divide-y divide-edge">
              {data.top.map((c, i) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-5 shrink-0 font-display text-sm font-semibold text-zinc-500">{i + 1}</span>
                  <Thumb card={c} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100">{c.name}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {c.setName}
                      {c.quantity > 1 ? ` · ×${c.quantity}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-sm font-semibold text-white">{formatMoney(c.price * c.quantity)}</p>
                    <p className="text-xs text-zinc-500">
                      {c.share < 0.001 ? "under 0.1%" : `${(c.share * 100).toFixed(c.share >= 0.1 ? 0 : 1)}%`} of total
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Value by set */}
          <section className={panel}>
            <div className="border-b border-edge px-4 py-3 sm:px-5">
              <h2 className={heading}>Value by set</h2>
            </div>
            <ul className="divide-y divide-edge">
              {data.bySet.slice(0, 12).map((b) => (
                <li key={b.name} className="px-4 py-2.5 sm:px-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm text-zinc-100">{b.name}</p>
                    <p className="shrink-0 font-display text-sm font-semibold text-white">
                      {formatMoney(b.value)} <span className="text-xs font-medium text-zinc-500">· {b.count}</span>
                    </p>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                    <div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.max(2, (b.value / maxSet) * 100)}%` }} />
                  </div>
                </li>
              ))}
              {data.bySet.length > 12 && (
                <li className="px-4 py-2.5 text-xs text-zinc-500 sm:px-5">
                  and {data.bySet.length - 12} more {data.bySet.length - 12 === 1 ? "set" : "sets"}
                </li>
              )}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
