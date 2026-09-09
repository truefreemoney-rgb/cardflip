"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import Spinner from "@/components/Spinner";
import { ago } from "@/components/admin/format";

interface Status {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  lastResult: string | null;
}

/**
 * "Finished" is only stamped when the Magic refresh succeeds (dailyJobs.ts),
 * and the crons fire once a day — so a finish older than this means a day
 * was missed or every run since has failed. Chris should see that in amber
 * without reading the steps.
 */
const OVERDUE_MS = 26 * 60 * 60 * 1000;

/**
 * Every step the two cron halves write into daily_last_result, in run order,
 * with a one-line reading of each result shape. A step that errored is red
 * and a skipped one amber — before this, only three of the seven steps were
 * shown, so a failing eBay or alert sweep was invisible on the ops page.
 */
const STEPS: { key: string; label: string; read: (v: Record<string, unknown>) => string }[] = [
  { key: "mtg", label: "Magic (Scryfall bulk)", read: (v) => `${n(v.updated)} updated · ${n(v.seriesTouched)} series` },
  {
    key: "pokemonTcgcsv",
    label: "Pokémon (TCGCSV)",
    read: (v) => `${n(v.seriesTouched)} series · ${n(v.groups)} groups${Number(v.groupsFailed) ? ` (${n(v.groupsFailed)} failed)` : ""}`,
  },
  { key: "pokemon", label: "Pokémon sweep", read: (v) => `${n(v.recorded)} points` },
  { key: "ebaySales", label: "eBay sales", read: (v) => `${n(v.sold)} sold · ${n(v.endedListings)} ended · ${n(v.sellers)} sellers` },
  { key: "ebayFees", label: "eBay fees", read: (v) => `${n(v.filled)} filled · ${n(v.sellers)} sellers` },
  { key: "wishlistAlerts", label: "Watchlist alerts", read: (v) => `${n(v.sent)} sent · ${n(v.checked)} checked` },
  { key: "autoOffers", label: "Watcher offers", read: (v) => `${n(v.sent)} sent${Number(v.failed) ? ` · ${n(v.failed)} failed` : ""} · ${n(v.sellers)} sellers` },
];

function n(v: unknown): string {
  return Number(v ?? 0).toLocaleString("en-US");
}

function stepView(last: Record<string, unknown> | null, step: (typeof STEPS)[number]): { text: string; tone: "ok" | "error" | "skipped" | "none"; title?: string } {
  const v = last?.[step.key] as Record<string, unknown> | undefined;
  if (!v) return { text: "—", tone: "none" };
  if ("error" in v) return { text: `error: ${String(v.error).slice(0, 60)}`, tone: "error", title: String(v.error) };
  if ("skipped" in v) return { text: `skipped: ${String(v.skipped).slice(0, 60)}`, tone: "skipped", title: String(v.skipped) };
  return { text: step.read(v), tone: "ok" };
}

const TONE: Record<string, string> = {
  ok: "text-zinc-200",
  error: "text-red-300",
  skipped: "text-amber-300",
  none: "text-zinc-500",
};

/**
 * Daily price-refresh status + "Run now"; polls while a run is in flight.
 * `now` is the server's read time: relative labels are computed from it so
 * the server and client render the same text (no hydration mismatch) and
 * render stays pure. A finished run refreshes the route, which brings a new
 * `now` with it.
 */
export default function DailyJobControl({ initial, now }: { initial: Status; now: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status.running) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(apiPath("/api/admin/jobs/daily"));
        const data = await res.json();
        if (data.status) {
          setStatus(data.status);
          if (!data.status.running) router.refresh();
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(iv);
  }, [status.running, router]);

  async function run() {
    setError(null);
    try {
      const res = await fetch(apiPath("/api/admin/jobs/daily"), { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't start");
      setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start");
    }
  }

  let last: Record<string, unknown> | null = null;
  try { last = status.lastResult ? JSON.parse(status.lastResult) : null; } catch { last = null; }
  const overdue = !status.running && (!status.finishedAt || now - status.finishedAt > OVERDUE_MS);
  const failed = STEPS.filter((s) => stepView(last, s).tone === "error").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            status.running ? "bg-brand-500/15 text-brand-300" : overdue ? "bg-amber-400/10 text-amber-300" : "bg-white/5 text-zinc-300"
          }`}
        >
          {status.running && <Spinner className="h-3 w-3" />}
          {status.running ? "Running…" : `${overdue ? "Overdue · " : ""}Last finished ${ago(status.finishedAt, now)}`}
        </span>
        {failed > 0 && !status.running && (
          <span className="rounded-full bg-red-400/10 px-3 py-1 text-xs font-medium text-red-300">
            {failed} step{failed === 1 ? "" : "s"} failed last run
          </span>
        )}
        <button
          onClick={run}
          disabled={status.running}
          className="rounded-full bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
        >
          Run Daily Refresh Now
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      {last ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s) => {
            const v = stepView(last, s);
            return (
              <div key={s.key} className="flex items-baseline justify-between gap-3 sm:block">
                <dt className="shrink-0 text-zinc-500">{s.label}</dt>
                <dd className={`truncate text-right sm:text-left ${TONE[v.tone]}`} title={v.title ?? v.text}>{v.text}</dd>
              </div>
            );
          })}
          <div className="flex items-baseline justify-between gap-3 sm:block">
            {/* On Vercel each cron half stamps its own ms, so this is the last half that ran. */}
            <dt className="text-zinc-500">Duration</dt>
            <dd className="text-zinc-200">{last.ms ? `${Math.round(Number(last.ms) / 1000)} s` : "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-xs text-zinc-500">No run recorded yet.</p>
      )}
    </div>
  );
}
