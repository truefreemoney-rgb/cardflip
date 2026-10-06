"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ShareImageButton from "@/components/ShareImageButton";
import { apiPath } from "@/lib/client/basePath";
import { formatMoney } from "@/lib/listing";
import type { GameId } from "@/lib/types";

/**
 * Collector mode's value header on Inventory (audit G15): total value, the 7-day change and up to
 * three top movers, a compact cut of the Insights page (same /api/cards/insights data) with a link
 * to the rest. Renders nothing until the data lands, or when there is nothing to count.
 */

interface Mover {
  id: string;
  name: string;
  price: number;
  delta: number;
  pct: number;
}
interface Insights {
  holding: number;
  value: { now: number; weekAgo: number | null };
  gainers: Mover[];
  losers: Mover[];
}

export default function CollectorValueHeader({ game, version = 0 }: { game: GameId; version?: number }) {
  // The answer remembers its game, so a switch shows nothing until the new one lands.
  const [result, setResult] = useState<{ game: GameId; version: number; data: Insights | null } | null>(null);

  useEffect(() => {
    let live = true;
    void fetch(apiPath(`/api/cards/insights?game=${game}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Insights) => {
        if (live) setResult({ game, version, data: j });
      })
      .catch(() => {
        if (live) setResult({ game, version, data: null });
      });
    return () => {
      live = false;
    };
  }, [game, version]);

  const data = result && result.game === game ? result.data : null;
  if (!data || !(data.holding > 0)) return null;

  const then = data.value.weekAgo;
  const delta = then != null && then > 0 ? data.value.now - then : null;
  const flat = delta != null && Math.abs(delta) < 0.005;
  const movers = [...data.gainers, ...data.losers].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);

  return (
    <section className="rounded-2xl border border-edge bg-surface-1 px-4 py-3" aria-label="Collection value">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Collection Value</p>
          <p className="font-display text-3xl font-bold tracking-tight text-white">{formatMoney(data.holding)}</p>
          <p className={`text-xs font-semibold ${delta == null || flat ? "text-zinc-500" : delta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {delta == null ? "7-day change after a week of history" : flat ? "Unchanged over 7 days" : `${delta > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(delta))} over 7 days`}
          </p>
        </div>
        <ShareImageButton path={`/api/share/collection?game=${game}`} fileName="cardflip-collection" className="shrink-0" />
      </div>
      {movers.length > 0 && (
        <ul className="mt-2 divide-y divide-edge/60 border-t border-edge/60">
          {movers.map((m) => (
            <li key={m.id} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
              <span className="min-w-0 truncate text-zinc-200">{m.name}</span>
              <span className={`shrink-0 font-semibold ${m.delta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {m.delta > 0 ? "▲" : "▼"} {formatMoney(Math.abs(m.delta))} · {Math.abs(m.pct).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/app/collection/insights" className="mt-1 inline-block text-xs font-medium text-brand-300 underline-offset-4 transition hover:text-brand-200 hover:underline">
        See All Insights →
      </Link>
    </section>
  );
}
