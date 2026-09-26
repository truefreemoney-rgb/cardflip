import Link from "next/link";
import ActivityBars from "@/components/admin/ActivityBars";
import { money, num } from "@/components/admin/format";
import { deltaPct, getAnalytics, parseRange, RANGES, type Metric } from "@/lib/server/analytics";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { PRICE } from "@/lib/pricing";

export const dynamic = "force-dynamic";
// ~45 small Turso queries in parallel; room for a slow one.
export const maxDuration = 60;

/**
 * /admin/analytics — the phone page (09-26). One column, every number with
 * its change against the period before, range switch pinned to the bottom
 * of a phone screen where a thumb is. Server-rendered, no client fetches.
 */
export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireOwnerPage();
  const { range: raw } = await searchParams;
  const range = parseRange(raw);
  const a = await getAnalytics(range);
  const m = a.metrics;
  const rangeLabel = RANGES.find((r) => r.id === range)!.label;
  const priorLabel = range === "24h" ? "the 24h before" : `the ${rangeLabel} before`;

  const usd = (v: number) => money(v);
  const cents4 = (v: number) => `$${v.toFixed(4)}`;
  const costPerScan = m.visionCalls.total ? m.visionCostUsd.total / m.visionCalls.total : 0;
  const matchRate = m.visionCalls.total ? Math.round((m.scans.total / m.visionCalls.total) * 100) : null;
  const priorMatchRate = m.visionCalls.prior ? Math.round((m.scans.prior / m.visionCalls.prior) * 100) : null;

  const headline: { label: string; metric: Metric; fmt?: (v: number) => string; good?: boolean }[] = [
    { label: "Visitors", metric: m.visitors },
    { label: "Page views", metric: m.pageViews },
    { label: "Sign-ups", metric: m.signups },
    { label: "Cards scanned", metric: m.scans },
    { label: "Sold", metric: m.sold },
    { label: "Sales", metric: m.soldUsd, fmt: usd, good: true },
  ];

  const trends: { title: string; metric: Metric; color: string; fmt?: (v: number) => string }[] = [
    { title: "Visitors", metric: m.visitors, color: "#fbbf24" },
    { title: "Page views", metric: m.pageViews, color: "#f59e0b" },
    { title: "Sign-ups", metric: m.signups, color: "var(--color-holo-sky)" },
    { title: "Cards scanned", metric: m.scans, color: "var(--color-brand-400)" },
    { title: "Price checks", metric: m.priceChecks, color: "var(--color-holo-violet)" },
    { title: "Listed on eBay", metric: m.listed, color: "#38bdf8" },
    { title: "Sold", metric: m.sold, color: "#34d399" },
    { title: "Sales $", metric: m.soldUsd, color: "#34d399", fmt: usd },
    { title: "Vision spend", metric: m.visionCostUsd, color: "#f472b6", fmt: usd },
    { title: "Watchlist adds", metric: m.wishlist, color: "var(--color-holo-gold)" },
    { title: "Help messages", metric: m.helpMessages, color: "#a78bfa" },
    { title: "Server errors", metric: m.errors, color: "#f87171" },
  ];

  const sub = a.subscriptions;
  const scanTotal = a.scansByGame.reduce((s, g) => s + g.scans, 0);
  const deviceTotal = a.devices.reduce((s, d) => s + d.visitors, 0);
  const countryTotal = a.countries.reduce((s, d) => s + d.visitors, 0);

  return (
    <section className="pb-20 sm:pb-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Last {rangeLabel}, each number against {priorLabel}. UTC days.
          </p>
        </div>
        <RangePicker range={range} className="hidden sm:flex" />
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {headline.map((k) => (
          <Tile key={k.label}>
            <p className={`font-display text-2xl font-semibold tabular-nums ${k.good ? "text-emerald-400" : "text-white"}`}>
              {(k.fmt ?? num)(k.metric.total)}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">{k.label}</p>
            <Delta cur={k.metric.total} prior={k.metric.prior} fmt={k.fmt} />
          </Tile>
        ))}
      </div>

      {/* Trends */}
      <H2>Trends</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {trends.map((c) => (
          <Tile key={c.title}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-zinc-200">{c.title}</p>
              <p className="text-xs text-zinc-500 tabular-nums">
                {(c.fmt ?? num)(c.metric.total)} <Delta cur={c.metric.total} prior={c.metric.prior} fmt={c.fmt} inline />
              </p>
            </div>
            <ActivityBars days={c.metric.series.keys} values={c.metric.series.values} color={c.color} hourly={c.metric.series.hourly} unit={c.fmt ? "usd" : undefined} />
          </Tile>
        ))}
      </div>

      {/* Funnel */}
      <H2>Funnel</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Funnel title={`Signed up in the last ${rangeLabel}`} steps={a.funnel.cohort} />
        <Funnel title="Everyone, all time" steps={a.funnel.allTime} />
      </div>

      {/* Scanner */}
      <H2>Scanner</H2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile>
          <Big>{num(m.visionCalls.total)}</Big>
          <Label>Vision calls</Label>
          <Delta cur={m.visionCalls.total} prior={m.visionCalls.prior} />
        </Tile>
        <Tile>
          <Big>{matchRate === null ? "—" : `${matchRate}%`}</Big>
          <Label>Matched a card</Label>
          {matchRate !== null && priorMatchRate !== null && (
            <p className={`mt-0.5 text-[11px] tabular-nums ${matchRate >= priorMatchRate ? "text-emerald-400" : "text-rose-400"}`}>
              {matchRate >= priorMatchRate ? "▲" : "▼"} {priorMatchRate}% before
            </p>
          )}
        </Tile>
        <Tile>
          <Big>{m.visionCalls.total ? cents4(costPerScan) : "—"}</Big>
          <Label>Cost per call</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">{usd(m.visionCostUsd.total)} total</p>
        </Tile>
        <Tile>
          <Big>{num(m.priceChecks.total)}</Big>
          <Label>Price checks</Label>
          <Delta cur={m.priceChecks.total} prior={m.priceChecks.prior} />
        </Tile>
        <Tile className="col-span-2">
          <p className="mb-2 text-sm font-medium text-zinc-200">Scans by game</p>
          <Bars rows={a.scansByGame.map((g) => ({ label: gameName(g.game), n: g.scans }))} total={scanTotal} color="var(--color-brand-400)" empty="No scans in this range." />
        </Tile>
        <Tile className="col-span-2">
          <p className="mb-2 text-sm font-medium text-zinc-200">Price checks by game</p>
          <Bars rows={a.priceChecksByGame.map((g) => ({ label: gameName(g.game), n: g.checks }))} total={m.priceChecks.total} color="var(--color-holo-violet)" empty="No price checks in this range." />
        </Tile>
      </div>

      {/* Traffic */}
      <H2>Traffic</H2>
      {!a.detailsCollected && (
        <p className="mb-3 rounded-xl border border-edge bg-surface-1 px-4 py-2.5 text-xs text-zinc-400">
          Referrers, devices and countries are recorded from Sep 26 on — older visits only carry a path.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Tile>
          <p className="mb-2 text-sm font-medium text-zinc-200">Top pages</p>
          {a.pages.length === 0 ? (
            <Empty>No visits in this range.</Empty>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="pb-1 font-normal">Path</th>
                  <th className="pb-1 text-right font-normal">Views</th>
                  <th className="pb-1 text-right font-normal">Visitors</th>
                </tr>
              </thead>
              <tbody>
                {a.pages.map((p) => (
                  <tr key={p.path} className="border-t border-white/5">
                    <td className="max-w-0 truncate py-1.5 pr-2 text-zinc-200" title={p.path}>{p.path}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-300">{num(p.views)}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-400">{num(p.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tile>
        <Tile>
          <p className="mb-2 text-sm font-medium text-zinc-200">Came from</p>
          <Bars rows={a.referrers.map((r) => ({ label: r.host, n: r.visitors }))} total={m.visitors.total} color="#fbbf24" empty="No outside referrers yet (direct, app icon, or typed in)." />
        </Tile>
        <Tile>
          <p className="mb-2 text-sm font-medium text-zinc-200">Devices</p>
          <Bars rows={a.devices.map((d) => ({ label: d.device, n: d.visitors }))} total={deviceTotal} color="var(--color-holo-sky)" empty="Nothing recorded yet." />
        </Tile>
        <Tile>
          <p className="mb-2 text-sm font-medium text-zinc-200">Countries</p>
          <Bars rows={a.countries.map((c) => ({ label: c.country, n: c.visitors }))} total={countryTotal} color="var(--color-holo-gold)" empty="Nothing recorded yet (local dev has no country header)." />
        </Tile>
      </div>

      {/* Money */}
      <H2>Money</H2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile>
          <Big className="text-emerald-400">{usd(sub.mrrUsd)}</Big>
          <Label>Monthly recurring</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">{PRICE.standard} × {sub.activeStandard} · {PRICE.pro} × {sub.activePro}</p>
        </Tile>
        <Tile>
          <Big>{num(sub.activeStandard + sub.activePro)}</Big>
          <Label>Paying now</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            {sub.totalUsers ? `${Math.round(((sub.activeStandard + sub.activePro) / sub.totalUsers) * 100)}% of ${num(sub.totalUsers)} users` : "no users yet"}
          </p>
        </Tile>
        <Tile>
          <Big className={sub.pastDue ? "text-amber-300" : undefined}>{num(sub.pastDue)}</Big>
          <Label>Past due</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">{num(sub.canceled)} canceled</p>
        </Tile>
        <Tile>
          <Big>{num(sub.ebayConnected)}</Big>
          <Label>eBay connected</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">{sub.totalUsers ? `${Math.round((sub.ebayConnected / sub.totalUsers) * 100)}% of users` : ""}</p>
        </Tile>
        <Tile>
          <Big className="text-emerald-400">{usd(m.soldUsd.total)}</Big>
          <Label>Sold through CardFlip</Label>
          <Delta cur={m.soldUsd.total} prior={m.soldUsd.prior} fmt={usd} />
        </Tile>
        <Tile>
          <Big>{num(m.listed.total)}</Big>
          <Label>Listed on eBay</Label>
          <Delta cur={m.listed.total} prior={m.listed.prior} />
        </Tile>
        <Tile>
          <Big className="text-rose-300">{usd(m.visionCostUsd.total)}</Big>
          <Label>Anthropic bill</Label>
          <Delta cur={m.visionCostUsd.total} prior={m.visionCostUsd.prior} fmt={usd} invert />
        </Tile>
        <Tile>
          <Big>{sub.rows.length ? num(sub.rows.reduce((s, r) => s + r.users, 0)) : "0"}</Big>
          <Label>Ever subscribed</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            {sub.rows.map((r) => `${r.plan} ${r.status} ${r.users}`).join(" · ") || "none yet"}
          </p>
        </Tile>
      </div>

      {/* Social */}
      <H2>Social</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Tile>
          {a.social.length === 0 ? (
            <Empty>No posts recorded yet.</Empty>
          ) : (
            <ul className="divide-y divide-white/5 text-xs">
              {a.social.map((s) => {
                const today = new Date(a.now).toISOString().slice(0, 10);
                const fresh = s.lastDay && s.lastDay >= new Date(a.now - 2 * 86_400_000).toISOString().slice(0, 10);
                return (
                  <li key={s.site} className="flex items-center justify-between py-1.5">
                    <span className="capitalize text-zinc-200">{s.site}</span>
                    <span className={`tabular-nums ${fresh ? "text-zinc-400" : "text-amber-300"}`}>
                      {s.lastDay ? `${s.lastDay === today ? "today" : s.lastDay} · ${s.postsThatDay} post${s.postsThatDay === 1 ? "" : "s"}` : "never"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-zinc-600">Last day each site posted (Eastern) and how many landed. Amber = quiet for 2+ days.</p>
        </Tile>
        <Tile>
          <p className="mb-2 text-sm font-medium text-zinc-200">Support</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Big>{num(m.helpMessages.total)}</Big>
              <Label>Help messages</Label>
              <Delta cur={m.helpMessages.total} prior={m.helpMessages.prior} />
            </div>
            <div>
              <Big className={m.errors.total ? "text-rose-300" : undefined}>{num(m.errors.total)}</Big>
              <Label>Server errors</Label>
              <Delta cur={m.errors.total} prior={m.errors.prior} invert />
            </div>
          </div>
        </Tile>
      </div>

      <div className="fixed inset-x-4 bottom-4 z-30 sm:hidden">
        <RangePicker range={range} className="flex w-full justify-between shadow-lg shadow-black/40" />
      </div>
    </section>
  );
}

function RangePicker({ range, className = "" }: { range: string; className?: string }) {
  return (
    <nav aria-label="Range" className={`items-center gap-1 rounded-full border border-edge bg-surface-1/95 p-1 text-xs backdrop-blur-md ${className}`}>
      {RANGES.map((r) => (
        <Link
          key={r.id}
          href={r.id === "7d" ? "/admin/analytics" : `/admin/analytics?range=${r.id}`}
          aria-current={r.id === range ? "page" : undefined}
          className={`flex-1 rounded-full px-3 py-1.5 text-center transition ${r.id === range ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}

function Tile({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-edge bg-surface-1 p-4 ${className}`}>{children}</div>;
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-zinc-500">{children}</h2>;
}
function Big({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`font-display text-2xl font-semibold tabular-nums ${className || "text-white"}`}>{children}</p>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-xs text-zinc-500">{children}</p>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-500">{children}</p>;
}

/** "▲ 12% · 40 before" — green up, rose down; `invert` for costs and errors. */
function Delta({ cur, prior, fmt, invert = false, inline = false }: { cur: number; prior: number; fmt?: (v: number) => string; invert?: boolean; inline?: boolean }) {
  const pct = deltaPct(cur, prior);
  const show = fmt ?? num;
  let text: string;
  let tone = "text-zinc-500";
  if (pct === null) text = "none before";
  else if (pct === 0) text = cur === 0 && prior === 0 ? "—" : "flat";
  else {
    const up = pct > 0;
    const good = invert ? !up : up;
    tone = good ? "text-emerald-400" : "text-rose-400";
    text = `${up ? "▲" : "▼"} ${Math.abs(pct)}%`;
  }
  if (inline) return <span className={tone}>{text}</span>;
  return (
    <p className={`mt-0.5 text-[11px] tabular-nums ${tone}`}>
      {text}
      {pct !== null && pct !== 0 && <span className="text-zinc-600"> · {show(prior)} before</span>}
    </p>
  );
}

function Bars({ rows, total, color, empty }: { rows: { label: string; n: number }[]; total: number; color: string; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-1.5 text-xs">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-zinc-200">{r.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-400">
              {num(r.n)}{total ? <span className="text-zinc-600"> · {Math.round((r.n / total) * 100)}%</span> : null}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.n / max) * 100)}%`, background: color, opacity: 0.85 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Funnel({ title, steps }: { title: string; steps: { signedUp: number; scanned: number; listed: number; sold: number; paying: number } }) {
  const order: [string, number][] = [
    ["Signed up", steps.signedUp],
    ["Scanned a card", steps.scanned],
    ["Listed on eBay", steps.listed],
    ["Sold a card", steps.sold],
    ["Paying", steps.paying],
  ];
  const top = Math.max(1, steps.signedUp);
  return (
    <Tile>
      <p className="mb-2 text-sm font-medium text-zinc-200">{title}</p>
      {steps.signedUp === 0 ? (
        <Empty>No accounts here yet.</Empty>
      ) : (
        <ol className="space-y-2 text-xs">
          {order.map(([label, n], i) => {
            const prev = i === 0 ? null : order[i - 1][1];
            const stepPct = prev ? Math.round((n / prev) * 100) : null;
            return (
              <li key={label}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-zinc-200">{label}</span>
                  <span className="tabular-nums text-zinc-400">
                    {num(n)}
                    <span className="text-zinc-600"> · {Math.round((n / top) * 100)}%{stepPct !== null && prev !== n ? ` · ${stepPct}% of prior` : ""}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-brand-400/80" style={{ width: `${Math.max(n ? 2 : 0, (n / top) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Tile>
  );
}

function gameName(g: string): string {
  if (g === "pokemon") return "Pokémon";
  if (g === "mtg") return "Magic";
  return g;
}
