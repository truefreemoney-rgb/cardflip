import Link from "next/link";
import type { ReactNode } from "react";
import ActivityBars from "@/components/admin/ActivityBars";
import NeedsYouList, { type NeedsYouItem } from "@/components/admin/NeedsYouList";
import { etDay } from "@/lib/time";
import { ago, money, num } from "@/components/admin/format";
import { getAdminOverview } from "@/lib/server/adminStats";
import { reportStaleOnceADay, staleChecks } from "@/lib/server/healthChecks";
import { getOverviewPulse, localTesterText } from "@/lib/server/overview";
import { scanSpendSummary } from "@/lib/server/scanUsage";
import { ebayRateLimits, GROWTH_CHECK_LINE } from "@/lib/server/ebayRateLimits";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";
// The overview is a dozen Turso queries; give it room past the 15s default so
// a slow one degrades to a slow page, never to a blank one (09-16).
export const maxDuration = 60;

/**
 * /admin — the front page (remade 09-27, Chris: "a proper overview of the
 * essentials", with support tickets). Top to bottom: what needs him today,
 * support, money, sellers, the 30-day charts, and the robots (social, daily
 * job, errors). Every section links to the page that owns it; nothing here
 * is editable. One column on a phone.
 */
export default async function AdminOverviewPage() {
  await requireOwnerPage();
  const [o, p, { last24h: spend24h, last30d: spend30d }, ebayLimits, stale] = await Promise.all([getAdminOverview(), getOverviewPulse(), scanSpendSummary(), ebayRateLimits(), staleChecks()]);
  // A visit also files the once-a-day Errors-page line if the backup or price run is stale.
  if (stale.length) void reportStaleOnceADay();
  const s = o.stats;
  const now = p.now;

  // "Needs you": only rows with something behind them. Empty = all quiet.
  const attention: NeedsYouItem[] = [];
  for (const st of stale) attention.push({ href: st.href, text: st.text, tone: st.tone });
  if (p.support.needsReply)
    attention.push({
      href: "/admin/support",
      text: `${num(p.support.needsReply)} support ticket${p.support.needsReply === 1 ? "" : "s"} waiting on a reply${p.support.oldestWaitingMs ? `, oldest ${ago(now - p.support.oldestWaitingMs, now)}` : ""}`,
      tone: "warn",
    });
  if (p.errors.last24h) attention.push({ href: "/admin/errors", text: `${num(p.errors.last24h)} server error${p.errors.last24h === 1 ? "" : "s"} in the last 24h`, tone: "bad" });
  if (p.money.pastDue) attention.push({ href: "/admin/users", text: `${num(p.money.pastDue)} subscription${p.money.pastDue === 1 ? "" : "s"} past due`, tone: "bad" });
  const quiet = p.social.sites.filter((x) => x.connected && !x.postedToday);
  if (quiet.length && eastHour(now) >= 8)
    attention.push({ href: "/admin/social", text: `No post yet today on ${quiet.map((x) => x.label).join(", ")}`, tone: "warn" });
  if (o.data.daily.lastResult && /error/i.test(o.data.daily.lastResult))
    attention.push({ href: "/admin/system", text: "The daily price job reported an error on its last run", tone: "bad" });
  if (p.money.nextBill && p.money.nextBill.days <= 3)
    attention.push({ href: "/admin/analytics", text: `${p.money.nextBill.name} bills ${dueWord(p.money.nextBill.days)} (${money(p.money.nextBill.amountUsd)})`, tone: "info" });
  if (p.money.unconfirmedCosts)
    attention.push({ href: "/admin/analytics", text: `${num(p.money.unconfirmedCosts)} expense amount${p.money.unconfirmedCosts === 1 ? "" : "s"} still to confirm`, tone: "info" });

  // A seller abroad connected eBay: the first real one is the local-market tester.
  for (const t of p.localTesters) attention.push({ href: "/admin/users", text: localTesterText(t.country, t.sellers), tone: "info" });

  const charts = [
    { title: "Visitors", series: o.activity.visitors, color: "#fbbf24" },
    { title: "Page views", series: o.activity.pageViews, color: "#f59e0b" },
    { title: "Cards scanned", series: o.activity.scans, color: "var(--color-brand-400)" },
    { title: "Sign-ups", series: o.activity.signups, color: "var(--color-holo-sky)" },
    { title: "Price checks", series: o.activity.priceChecks, color: "var(--color-holo-violet)" },
    { title: "Sold", series: o.activity.sold, color: "#34d399" },
  ];

  const daily = o.data.daily;

  return (
    <section>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-white">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">What needs you, then every account, card and dollar on CardFlip right now.</p>
      </div>

      {/* Needs you (each row closable for the day, NeedsYouList) */}
      <NeedsYouList items={attention} day={etDay(now)} />

      {/* Support */}
      <H2 href="/admin/support" link="All Tickets">Support</H2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile>
          <Big className={p.support.needsReply ? "text-amber-300" : undefined}>{num(p.support.needsReply)}</Big>
          <Label>Waiting on you</Label>
          <Sub>{p.support.oldestWaitingMs ? `oldest ${ago(now - p.support.oldestWaitingMs, now)}` : "nothing unanswered"}</Sub>
        </Tile>
        <Tile>
          <Big>{num(p.support.open)}</Big>
          <Label>Open tickets</Label>
        </Tile>
        <Tile>
          <Big>{num(p.support.closed7d)}</Big>
          <Label>Closed this week</Label>
        </Tile>
        <Tile>
          <Big>{num(p.support.helpMessages24h)}</Big>
          <Label>Help chat questions</Label>
          <Sub>last 24h, answered by the robot</Sub>
        </Tile>
        <Tile className="col-span-2 md:col-span-4">
          {p.support.recent.length === 0 ? (
            <p className="py-1 text-sm text-zinc-500">No open tickets. Sellers open them from Help, and they show up here.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {p.support.recent.map((t) => (
                <li key={t.id}>
                  <Link href={`/admin/support?ticket=${t.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-white">
                    <span className="w-14 shrink-0 text-xs tabular-nums text-zinc-500">#{t.number}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{t.subject}</span>
                    <span className="hidden max-w-32 truncate text-xs text-zinc-500 sm:inline">{t.userName}</span>
                    {t.needsReply ? (
                      <span className="shrink-0 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300">Needs Reply</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-zinc-400/10 px-2 py-0.5 text-[11px] text-zinc-400">Replied</span>
                    )}
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-600">{ago(t.updatedAt, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </div>

      {/* Money */}
      <H2 href="/admin/analytics" link="Analytics">Money</H2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile>
          <Big className="text-emerald-400">{money(p.money.mrrUsd)}</Big>
          <Label>Coming in per month</Label>
          <Sub>{num(p.money.activeStandard + p.money.activePro)} paying · {num(p.money.activeStandard)} standard, {num(p.money.activePro)} pro</Sub>
        </Tile>
        <Tile>
          <Big>{money(p.money.costsMonthlyUsd)}</Big>
          <Label>Going out per month</Label>
          <Sub>{p.money.unconfirmedCosts ? `${num(p.money.unconfirmedCosts)} amount${p.money.unconfirmedCosts === 1 ? "" : "s"} unconfirmed` : "amounts confirmed"}</Sub>
        </Tile>
        <Tile>
          <Big className={p.money.mrrUsd - p.money.costsMonthlyUsd >= 0 ? "text-emerald-400" : "text-rose-400"}>{signedMoney(p.money.mrrUsd - p.money.costsMonthlyUsd)}</Big>
          <Label>Left over per month</Label>
          <Sub>{p.money.nextBill ? `next bill ${p.money.nextBill.name}, ${dueWord(p.money.nextBill.days)}` : "no bills dated"}</Sub>
        </Tile>
        <Tile>
          <Big>{money(s.grossRevenue)}</Big>
          <Label>Sellers sold, all time</Label>
          <Sub>{num(s.soldCount)} card{s.soldCount === 1 ? "" : "s"} · {money(s.netRevenue)} to them after fees</Sub>
        </Tile>
        <Tile>
          <Big>{money(spend30d.usd)}</Big>
          <Label>Vision spend, 30d</Label>
          <Sub>{spend30d.scans ? `${num(spend30d.scans)} calls · $${(spend30d.usd / spend30d.scans).toFixed(4)} each` : "no scans recorded yet"}</Sub>
        </Tile>
        <Tile>
          <Big>{money(spend24h.usd)}</Big>
          <Label>Vision spend, 24h</Label>
          <Sub>{num(spend24h.scans)} call{spend24h.scans === 1 ? "" : "s"}</Sub>
        </Tile>
      </div>

      {/* Sellers */}
      <H2 href="/admin/users" link="Users">Sellers</H2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Tile>
          <Big>{num(s.totalUsers)}</Big>
          <Label>Users</Label>
          <Sub>+{num(s.newUsers7d)} this week</Sub>
        </Tile>
        <Tile>
          <Big>{num(s.connectedUsers)}</Big>
          <Label>eBay connected</Label>
          <Sub>{s.totalUsers ? `${Math.round((s.connectedUsers / s.totalUsers) * 100)}% of users` : "—"}</Sub>
        </Tile>
        <Tile>
          <Big>{num(s.totalCards)}</Big>
          <Label>Cards scanned</Label>
          <Sub>+{num(s.scans7d)} this week · {num(s.scans30d)} / 30d</Sub>
        </Tile>
        <Tile>
          <Big>{num(s.pokemonCards)} · {num(s.mtgCards)}</Big>
          <Label>Pokémon · Magic</Label>
        </Tile>
        <Tile>
          <Big>{num(s.readyCount)}</Big>
          <Label>Drafts</Label>
        </Tile>
        <Tile>
          <Big className="text-brand-300">{num(s.listedCount)}</Big>
          <Label>Listed on eBay</Label>
        </Tile>
        <Tile>
          <Big>{num(s.soldCount)}</Big>
          <Label>Sold</Label>
        </Tile>
        <Tile>
          <Big>{num(s.wishlistItems)}</Big>
          <Label>Watchlist items</Label>
          <Sub>{num(s.priceChecks7d)} price checks this week</Sub>
        </Tile>
      </div>

      {/* Activity */}
      <H2>Last 30 days</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {charts.map((c) => (
          <Tile key={c.title}>
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-sm font-medium text-zinc-200">{c.title}</p>
              <p className="text-xs text-zinc-500 tabular-nums">{num(c.series.total)} / 30d</p>
            </div>
            <ActivityBars days={c.series.days} values={c.series.values} color={c.color} />
          </Tile>
        ))}
      </div>

      {/* Robots */}
      <H2>Robots</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tile>
          <Head href="/admin/social" link="Social">Social posts today</Head>
          <ul className="mt-1 space-y-1.5">
            {p.social.sites.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 text-zinc-200">
                  <span className={`h-1.5 w-1.5 rounded-full ${!x.connected ? "bg-zinc-600" : x.postedToday ? "bg-emerald-400" : "bg-amber-400"}`} />
                  {x.label}
                </span>
                <span className="text-xs tabular-nums text-zinc-500">
                  {!x.connected ? "not connected" : x.postedToday ? "posted" : x.lastDay ? `last ${dayLabel(x.lastDay)}` : "never posted"}
                </span>
              </li>
            ))}
          </ul>
        </Tile>
        <Tile>
          <Head href="/admin/system" link="System">Daily price job</Head>
          <p className="mt-1 text-sm text-zinc-200">
            {daily.running ? "Running now" : daily.finishedAt ? `Finished ${ago(daily.finishedAt, now)}` : "Has not run yet"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {daily.lastResult ? summarizeDaily(daily.lastResult) : "No result recorded."}
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            Catalog: {num(o.data.priceSeries.total)} price series{o.data.priceSeries.latestDay ? `, latest ${dayLabel(o.data.priceSeries.latestDay)}` : ""}
            {o.data.catalogStale ? " (refreshing)" : ""}
          </p>
        </Tile>
        <Tile>
          <Head href="/admin/errors" link="Errors">Server errors, 24h</Head>
          <p className={`mt-1 text-sm ${p.errors.last24h ? "text-rose-300" : "text-zinc-200"}`}>
            {p.errors.last24h ? `${num(p.errors.last24h)} error${p.errors.last24h === 1 ? "" : "s"}` : "None"}
          </p>
          {p.errors.groups.length > 0 && (
            <ul className="mt-1 space-y-1">
              {p.errors.groups.map((g) => (
                <li key={`${g.source}:${g.message}`} className="text-xs text-zinc-500">
                  <span className="tabular-nums text-zinc-400">{num(g.count)}×</span> <code className="text-zinc-400">{g.source}</code>{" "}
                  <span className="text-zinc-500">{g.message.slice(0, 80)}</span>
                </li>
              ))}
            </ul>
          )}
        </Tile>
        {/* eBay's daily call caps for our app (10-03, Chris: "how bad is eBay going
            to get hammered with a lot of users?"). Calls are free; the cap is the
            wall, and a cap under GROWTH_CHECK_LINE means the free growth check has
            not happened yet. Read from eBay's analytics API, memoed ten minutes. */}
        <Tile>
          <Head href="https://developer.ebay.com/my/keys" link="eBay keys">eBay API limits today</Head>
          {ebayLimits.error ? (
            <p className="mt-1 text-xs text-rose-300">{ebayLimits.error}</p>
          ) : ebayLimits.rows.length === 0 ? (
            <p className="mt-1 text-xs text-zinc-500">eBay reported no limits for the APIs we use.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {ebayLimits.rows.map((r) => {
                const pct = r.limit > 0 ? r.used / r.limit : 0;
                const tone = pct >= 0.8 ? "text-rose-300" : pct >= 0.5 ? "text-amber-300" : "text-zinc-200";
                return (
                  <li key={r.api} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-zinc-400">{r.api}</span>
                    <span className={`tabular-nums ${tone}`} title={`${r.resource || "all resources"}${r.resetAt ? `, resets ${ago(r.resetAt, now).replace(" ago", "")} from now` : ""}`}>
                      {num(r.used)} of {num(r.limit)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-zinc-600">
            {ebayLimits.rows.some((r) => r.limit > 0 && r.limit < GROWTH_CHECK_LINE)
              ? "Starter caps: eBay's free application growth check raises these into the millions. File it before real sellers arrive."
              : ebayLimits.rows.length > 0
                ? "Grown-up caps: the growth check is done."
                : ""}
            {ebayLimits.at ? ` Read ${ago(ebayLimits.at, now)}.` : ""}
          </p>
          {ebayLimits.note && <p className="mt-1 text-[11px] text-amber-300/80">{ebayLimits.note}</p>}
        </Tile>
      </div>
    </section>
  );
}

// --- bits ---------------------------------------------------------------------------

function Tile({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-edge bg-surface-1 p-4 ${className}`}>{children}</div>;
}
function Big({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-display text-xl font-semibold tabular-nums ${className || "text-white"}`}>{children}</p>;
}
function Label({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-xs text-zinc-500">{children}</p>;
}
function Sub({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-[11px] text-zinc-600">{children}</p>;
}
function H2({ children, href, link }: { children: ReactNode; href?: string; link?: string }) {
  return (
    <div className="mb-2 mt-5 flex items-baseline justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{children}</h2>
      {href && link && (
        <Link href={href} className="text-xs text-zinc-500 hover:text-zinc-300">
          {link} →
        </Link>
      )}
    </div>
  );
}
function Head({ children, href, link }: { children: ReactNode; href: string; link: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <p className="text-sm font-medium text-zinc-200">{children}</p>
      <Link href={href} className="text-xs text-zinc-500 hover:text-zinc-300">
        {link} →
      </Link>
    </div>
  );
}

function eastHour(now: number): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(now)) % 24;
}
function signedMoney(v: number): string {
  return v < 0 ? `-${money(-v)}` : money(v);
}
function dueWord(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
/** The daily job stores its result as JSON; turn it into one plain line, the steps Chris cares about first. */
const DAILY_STEPS: Record<string, { label: string; key: string; unit: string }> = {
  pokemon: { label: "Pokémon", key: "recorded", unit: "prices" },
  pokemonTcgcsv: { label: "TCGplayer", key: "seriesTouched", unit: "series" },
  mtg: { label: "Magic", key: "updated", unit: "prices" },
  ebaySales: { label: "eBay sales", key: "sold", unit: "sold" },
  ebayFees: { label: "eBay fees", key: "filled", unit: "filled" },
  wishlistAlerts: { label: "Dip alerts", key: "sent", unit: "sent" },
  autoOffers: { label: "Auto offers", key: "sent", unit: "sent" },
};
function summarizeDaily(raw: string): string {
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, step] of Object.entries(DAILY_STEPS)) {
      const v = r[k];
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      if ("error" in o) parts.push(`${step.label}: error`);
      else if ("skipped" in o) parts.push(`${step.label}: skipped`);
      else parts.push(`${step.label} ${num(Number(o[step.key] ?? 0))} ${step.unit}`);
    }
    return parts.length ? parts.join(" · ") : raw.slice(0, 160);
  } catch {
    return raw.slice(0, 160);
  }
}
