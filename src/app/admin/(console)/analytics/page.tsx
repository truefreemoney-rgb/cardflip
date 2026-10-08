import Link from "next/link";
import ActivityBars from "@/components/admin/ActivityBars";
import Expenses from "@/components/admin/Expenses";
import RangeDates from "@/components/admin/RangeDates";
import { money, num } from "@/components/admin/format";
import { deltaPct, getAnalytics, parseWindow, RANGES, type CustomWindow, type Metric } from "@/lib/server/analytics";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { sourceLabel } from "@/lib/attribution";
import { daysUntil, loadExpenses, monthlyTotal, nextDue } from "@/lib/server/expenses";
import { PRICE } from "@/lib/pricing";
import { etDay } from "@/lib/time";

export const dynamic = "force-dynamic";
// ~45 small Turso queries in parallel; room for a slow one.
export const maxDuration = 60;

/**
 * /admin/analytics — the phone page (09-26). One column, every number with
 * its change against the period before, range switch pinned to the bottom
 * of a phone screen where a thumb is. Server-rendered, no client fetches.
 */
export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requireOwnerPage();
  const params = await searchParams;
  const win = parseWindow(params);
  const custom = typeof win === "string" ? null : win;
  const range: string = typeof win === "string" ? win : "custom";
  const [a, expenses] = await Promise.all([getAnalytics(win), loadExpenses()]);
  const m = a.metrics;
  // The Anthropic API is one ordinary expense row Chris keeps from the console (09-27: no separate measured
  // scan-spend line). Big testing months are one-off rows, out of the total.
  const costsMonthly = Math.round(monthlyTotal(expenses) * 100) / 100;
  const unconfirmedCosts = expenses.filter((e) => !e.confirmed).length;
  // Soonest recurring bill: the tile shows the name and how many days away.
  const upcoming = expenses
    .filter((e) => e.period !== "once")
    .map((e) => ({ e, day: nextDue(e) }))
    .filter((x): x is { e: (typeof expenses)[number]; day: string } => x.day !== null)
    .sort((x, y) => x.day.localeCompare(y.day))[0];
  const upcomingDays = upcoming ? daysUntil(upcoming.day) : null;
  const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const windowLabel = custom ? `${day(custom.from)} to ${day(custom.to)}` : `Last ${RANGES.find((r) => r.id === range)!.label}`;
  const priorLabel = custom ? `the ${custom.days} day${custom.days === 1 ? "" : "s"} before` : range === "24h" ? "the 24h before" : `the ${RANGES.find((r) => r.id === range)!.label} before`;

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
    { label: "Subscriptions", metric: m.subPayments },
    { label: "Boosters", metric: m.boosters },
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

  // Total income (Chris 10-07): subscription payments + Booster buys, same window and the one before.
  const income = { total: m.subIncomeUsd.total + m.boosterIncomeUsd.total, prior: m.subIncomeUsd.prior + m.boosterIncomeUsd.prior };
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
            {windowLabel}, each number against {priorLabel}. Eastern time. Money below is all-time and ignores the range.
          </p>
        </div>
        <RangePicker range={range} custom={custom} className="hidden sm:flex" />
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
        <Tile className="col-span-2 md:col-span-3 xl:col-span-6">
          <p className="font-display text-2xl font-semibold tabular-nums text-emerald-400">{usd(income.total)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Total income · subscriptions {usd(m.subIncomeUsd.total)} + boosters {usd(m.boosterIncomeUsd.total)}
          </p>
          <Delta cur={income.total} prior={income.prior} fmt={usd} />
        </Tile>
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
        <Funnel title={custom ? `Signed up ${windowLabel}` : `Signed up in the ${windowLabel.toLowerCase()}`} steps={a.funnel.cohort} />
        <Funnel
          title={custom ? `Everyone, ${windowLabel}` : `Everyone, ${windowLabel.toLowerCase()}`}
          firstLabel="Had an account"
          steps={a.funnel.everyone}
        />
      </div>

      {/* Where people come from (lib/attribution.ts) */}
      <H2>Where sign-ups come from</H2>
      {!a.attribution.collected && (
        <p className="mb-3 rounded-xl border border-edge bg-surface-1 px-4 py-2.5 text-xs text-zinc-400">
          Sources are recorded from Sep 30 on — earlier accounts show as not recorded.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Tile className="md:col-span-2">
          <p className="mb-2 text-sm font-medium text-zinc-200">Sign-ups by source</p>
          {a.attribution.signups.length === 0 ? (
            <Empty>No sign-ups in this range.</Empty>
          ) : (
            <ul className="space-y-3 text-xs">
              {a.attribution.signups.map((s) => (
                <li key={s.source}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-zinc-200">{sourceLabel(s.source)}</span>
                    <span className="shrink-0 tabular-nums text-zinc-400">
                      {num(s.signups)}
                      <span className="text-zinc-600"> · {num(s.paying)} paying</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-brand-400/80" style={{ width: `${Math.max(2, (s.signups / Math.max(1, m.signups.total)) * 100)}%` }} />
                  </div>
                  {s.campaigns.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 pl-3 text-[11px]">
                      {s.campaigns.map((c) => (
                        <li key={c.campaign} className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-mono text-zinc-400" title={c.campaign}>{c.campaign}</span>
                          <span className="shrink-0 tabular-nums text-zinc-500">
                            {num(c.signups)}
                            <span className="text-zinc-600"> · {num(c.paying)} paying</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tile>
        <Tile>
          <p className="mb-2 text-sm font-medium text-zinc-200">Visitors by source</p>
          <Bars rows={a.attribution.visitors.map((v) => ({ label: sourceLabel(v.source), n: v.visitors }))} total={m.visitors.total} color="#fbbf24" empty="Nothing recorded yet." />
        </Tile>
        <Tile>
          <p className="mb-2 text-sm font-medium text-zinc-200">First page of sign-ups</p>
          <Bars rows={a.attribution.landings.map((l) => ({ label: l.path, n: l.signups }))} total={m.signups.total} color="var(--color-holo-sky)" empty="Nothing recorded yet." />
        </Tile>
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile>
          <Big className="text-emerald-400">{usd(sub.mrrUsd)}</Big>
          <Label>Money in every month</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            {PRICE.standard} × {sub.activeStandard} Standard · {PRICE.pro} × {sub.activePro} Pro
          </p>
        </Tile>
        <Tile>
          <Big className="text-rose-300">{usd(costsMonthly)}</Big>
          <Label>Money out every month</Label>
          <p className={`mt-0.5 text-[11px] ${unconfirmedCosts ? "text-amber-300" : "text-zinc-600"}`}>
            {unconfirmedCosts ? `${unconfirmedCosts} amount${unconfirmedCosts === 1 ? " is a guess" : "s are guesses"}, check below` : "every amount confirmed"}
          </p>
        </Tile>
        <Tile>
          <Big className={sub.mrrUsd - costsMonthly >= 0 ? "text-emerald-400" : "text-rose-300"}>{usd(sub.mrrUsd - costsMonthly)}</Big>
          <Label>Left over every month</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">in minus out</p>
        </Tile>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile>
          <Big className={upcomingDays !== null && upcomingDays <= 3 ? "text-amber-300" : undefined}>
            {upcoming ? (upcomingDays === 0 ? "Today" : upcomingDays === 1 ? "Tomorrow" : `${upcomingDays} days`) : "—"}
          </Big>
          <Label>Next bill due</Label>
          <p className="mt-0.5 truncate text-[11px] text-zinc-600">{upcoming ? `${upcoming.e.name} · ${usd(upcoming.e.amountUsd)} · ${upcoming.day}` : "add due dates below"}</p>
        </Tile>
        <Tile>
          <Big className={sub.pastDue ? "text-amber-300" : undefined}>{num(sub.activeStandard + sub.activePro)}</Big>
          <Label>Paying now</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            {sub.totalUsers ? `${Math.round(((sub.activeStandard + sub.activePro) / sub.totalUsers) * 100)}% of ${num(sub.totalUsers)} users` : "no users yet"}
            {sub.pastDue ? ` · ${num(sub.pastDue)} past due` : ""}
            {sub.canceled ? ` · ${num(sub.canceled)} canceled` : ""}
          </p>
        </Tile>
        <Tile>
          <Big className="text-emerald-400">{usd(a.lifetime.soldUsd)}</Big>
          <Label>Sold through CardFlip</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">{num(a.lifetime.sold)} card{a.lifetime.sold === 1 ? "" : "s"}, all time</p>
        </Tile>
        <Tile>
          <Big>{num(sub.ebayConnected)}</Big>
          <Label>eBay connected</Label>
          <p className="mt-0.5 text-[11px] text-zinc-600">{num(a.lifetime.listed)} listed, all time</p>
        </Tile>
      </div>
      <Tile className="mt-3">
        <Expenses expenses={expenses} />
      </Tile>

      {/* Social */}
      <H2>Social</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Tile>
          {a.social.length === 0 ? (
            <Empty>No posts recorded yet.</Empty>
          ) : (
            <ul className="divide-y divide-white/5 text-xs">
              {a.social.map((s) => {
                // lastDay is an Eastern day key, so compare it to Eastern days (UTC's said "tomorrow" after 8pm ET).
                const today = etDay(a.now);
                const fresh = s.lastDay && s.lastDay >= etDay(a.now - 2 * 86_400_000);
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
        <RangePicker range={range} custom={custom} up className="flex w-full justify-between shadow-lg shadow-black/40" />
      </div>
    </section>
  );
}

function RangePicker({ range, custom, up = false, className = "" }: { range: string; custom: CustomWindow | null; up?: boolean; className?: string }) {
  return (
    <nav aria-label="Range" className={`items-center gap-1 rounded-full border border-edge bg-surface-1/95 p-1 text-xs backdrop-blur-md ${className}`}>
      <RangeDates from={custom?.from} to={custom?.to} active={custom !== null} up={up} />
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

function Funnel({ title, steps, firstLabel = "Signed up" }: { title: string; firstLabel?: string; steps: { signedUp: number; scanned: number; listed: number; sold: number; paying: number } }) {
  const order: [string, number][] = [
    [firstLabel, steps.signedUp],
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
                    <span className="text-zinc-600"> · {Math.round((n / top) * 100)}%{stepPct !== null && prev !== n && stepPct <= 100 ? ` · ${stepPct}% of prior` : ""}</span>
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
