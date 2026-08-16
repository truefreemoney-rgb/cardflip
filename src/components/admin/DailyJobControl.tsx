"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";
import Spinner from "@/components/Spinner";

interface Status {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  lastResult: string | null;
}

function ago(ts: number | null): string {
  if (!ts) return "never";
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Daily price-refresh status + "Run now"; polls while a run is in flight. */
export default function DailyJobControl({ initial }: { initial: Status }) {
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
  const summary = (key: string) => {
    const v = last?.[key] as Record<string, unknown> | undefined;
    if (!v) return "—";
    if ("error" in v) return `error: ${String(v.error).slice(0, 60)}`;
    if ("skipped" in v) return `skipped`;
    if ("seriesTouched" in v) return `${v.seriesTouched} series`;
    if ("recorded" in v) return `${v.recorded} points`;
    return JSON.stringify(v);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${status.running ? "bg-brand-500/15 text-brand-300" : "bg-white/5 text-zinc-300"}`}>
          {status.running && <Spinner className="h-3 w-3" />}
          {status.running ? "Running…" : `Last finished ${ago(status.finishedAt)}`}
        </span>
        <button
          onClick={run}
          disabled={status.running}
          className="rounded-full bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50"
        >
          Run daily refresh now
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      {last && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <div><dt className="text-zinc-500">Magic (Scryfall bulk)</dt><dd className="text-zinc-200">{summary("mtg")}</dd></div>
          <div><dt className="text-zinc-500">Pokémon (TCGCSV)</dt><dd className="text-zinc-200">{summary("pokemonTcgcsv")}</dd></div>
          <div><dt className="text-zinc-500">Pokémon sweep</dt><dd className="text-zinc-200">{summary("pokemon")}</dd></div>
          <div><dt className="text-zinc-500">Duration</dt><dd className="text-zinc-200">{last.ms ? `${Math.round(Number(last.ms) / 1000)} s` : "—"}</dd></div>
        </dl>
      )}
    </div>
  );
}
