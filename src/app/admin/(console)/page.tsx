import ActivityBars from "@/components/admin/ActivityBars";
import { money, num } from "@/components/admin/format";
import { getAdminOverview } from "@/lib/server/adminStats";
import { scanSpendSummary } from "@/lib/server/scanUsage";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [o, { last24h: spend24h, last30d: spend30d }] = await Promise.all([getAdminOverview(), scanSpendSummary()]);
  const s = o.stats;

  const kpis: { label: string; value: string; sub?: string; accent?: "good" | "brand" }[] = [
    { label: "Users", value: num(s.totalUsers), sub: `+${s.newUsers7d} this week` },
    { label: "eBay connected", value: num(s.connectedUsers), sub: s.totalUsers ? `${Math.round((s.connectedUsers / s.totalUsers) * 100)}% of users` : undefined },
    { label: "Cards scanned", value: num(s.totalCards), sub: `+${s.scans7d} this week · ${s.scans30d} / 30d` },
    { label: "Pokémon · Magic", value: `${num(s.pokemonCards)} · ${num(s.mtgCards)}` },
    { label: "Drafts", value: num(s.readyCount) },
    { label: "Listed", value: num(s.listedCount), accent: "brand" },
    { label: "Sold", value: num(s.soldCount) },
    { label: "Gross sales", value: money(s.grossRevenue) },
    { label: "Est. eBay fees", value: money(s.estimatedFees) },
    { label: "Net to sellers", value: money(s.netRevenue), accent: "good" },
    { label: "Watchlist items", value: num(s.wishlistItems) },
    { label: "Price checks", value: `${num(s.priceChecks7d)}`, sub: "this week" },
    // The measured Anthropic bill (scan_usage), not an estimate — the number
    // the $9.99/500 margin actually rests on. Per-scan is the headline.
    {
      label: "Vision cost / scan",
      value: spend30d.scans ? `$${(spend30d.usd / spend30d.scans).toFixed(4)}` : "—",
      sub: spend30d.scans
        ? `${num(spend30d.scans)} scans / 30d · $${spend30d.usd.toFixed(2)} · ~${num(spend30d.avgInputTokens)} in / ${num(spend30d.avgOutputTokens)} out tokens`
        : "no scans recorded yet",
    },
    {
      label: "Vision spend 24h",
      value: `$${spend24h.usd.toFixed(2)}`,
      sub: `${num(spend24h.scans)} scans`,
    },
  ];

  return (
    <section>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Overview</h1>
          <p className="mt-1 text-sm text-zinc-500">Every account, card and dollar on CardFlip, right now.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-edge bg-surface-1 p-4">
            <p className={`font-display text-xl font-semibold tabular-nums ${k.accent === "good" ? "text-emerald-400" : k.accent === "brand" ? "text-brand-300" : "text-white"}`}>{k.value}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{k.label}</p>
            {k.sub && <p className="mt-0.5 text-[11px] text-zinc-600">{k.sub}</p>}
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "Cards scanned", series: o.activity.scans, color: "var(--color-brand-400)" },
          { title: "Sign-ups", series: o.activity.signups, color: "var(--color-holo-sky)" },
          { title: "Price checks", series: o.activity.priceChecks, color: "var(--color-holo-violet)" },
          { title: "Sold", series: o.activity.sold, color: "#34d399" },
        ].map((c) => (
          <div key={c.title} className="rounded-2xl border border-edge bg-surface-1 p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-sm font-medium text-zinc-200">{c.title}</p>
              <p className="text-xs text-zinc-500">{num(c.series.total)} / 30d</p>
            </div>
            <ActivityBars days={c.series.days} values={c.series.values} color={c.color} />
          </div>
        ))}
      </div>
    </section>
  );
}
