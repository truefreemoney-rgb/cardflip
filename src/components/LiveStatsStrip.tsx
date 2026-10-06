import type { LiveStats } from "@/lib/server/liveStats";

/**
 * "The site is alive" strip for the top of the home and /scan pages. Real
 * counts only (lib/server/liveStats.ts) — a stat that reads 0 is left off,
 * and the whole strip hides when there's nothing true to show.
 */
export default function LiveStatsStrip({ stats, className = "" }: { stats: LiveStats; className?: string }) {
  const tiles = [
    { label: "Cards Tracked", n: stats.cards },
    { label: "Cards Repriced", n: stats.prices },
  ].filter((t) => t.n > 0);
  if (tiles.length === 0) return null;
  const when = stats.updatedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(stats.updatedAt)
    : null;
  return (
    <div className={`w-full max-w-md rounded-2xl border border-edge bg-surface-1 px-3 py-2.5 ${className}`}>
      {when && (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
          Prices updated {when} ET
        </p>
      )}
      <dl className={`grid gap-2 ${when ? "mt-2" : ""} ${tiles.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0 rounded-xl bg-black/30 px-3 py-2">
            <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t.label}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums text-white">{t.n.toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
