import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import ActivityBars from "@/components/admin/ActivityBars";
import AdminUsersTable from "@/components/admin/AdminUsersTable";
import DailyJobControl from "@/components/admin/DailyJobControl";
import AdminSignOut from "@/components/admin/AdminSignOut";
import FeatureToggles from "@/components/admin/FeatureToggles";
import { magicPublic } from "@/lib/server/settings";
import { hasAdminSession } from "@/lib/server/adminGate";
import { getAdminOverview } from "@/lib/server/adminStats";
import { isDemoUser, listAllUsers, monthlyScans, scanTier } from "@/lib/server/users";
import { listAllCards } from "@/lib/server/cards";
import { errorCount24h, listRecentErrors } from "@/lib/server/errorLog";
import { scanSpendSummary } from "@/lib/server/scanUsage";

export const dynamic = "force-dynamic";

function money(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function num(v: number): string {
  return v.toLocaleString("en-US");
}
function bytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e3)} KB`;
}
function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function uptime(sec: number): string {
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} d`;
}

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-zinc-400/10 text-zinc-300",
  listed: "bg-sky-400/10 text-sky-300",
  sold: "bg-emerald-400/10 text-emerald-300",
};

const NAV = [
  ["overview", "Overview"],
  ["switches", "Switches"],
  ["users", "Users"],
  ["cards", "Cards"],
  ["data", "Prices & data"],
  ["errors", "Errors"],
  ["system", "System"],
] as const;

export default async function AdminPage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const o = await getAdminOverview();
  const users = (await listAllUsers()).map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, ebayConnected: u.ebayConnected, createdAt: u.createdAt, isDemo: isDemoUser(u),
    tier: scanTier(u), plan: u.plan, scansUsed: u.scansUsed, monthlyScans: monthlyScans(u), trialScansUsed: u.trialScansUsed,
    accessOverride: u.accessOverride, subStatus: u.subStatus,
  }));
  const cards = await listAllCards(60);
  const [recentErrors, errors24h, { last24h: spend24h, last30d: spend30d }, magicOn] = await Promise.all([
    listRecentErrors(50),
    errorCount24h(),
    scanSpendSummary(),
    magicPublic(),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
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
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-medium text-brand-300">Admin console</span>
          </div>
          <nav className="flex flex-wrap items-center gap-1 rounded-full border border-edge bg-surface-1 p-1 text-xs">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-full px-3 py-1 text-zinc-400 transition hover:bg-white/5 hover:text-white">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/app" className="text-zinc-400 transition hover:text-white">← App</Link>
            <AdminSignOut />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6">
        {o.system.adminDefaults && (
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-200">
            The console is using the built-in operator credentials. Set <code className="rounded bg-black/30 px-1">ADMIN_PANEL_USER</code> and{" "}
            <code className="rounded bg-black/30 px-1">ADMIN_PANEL_PASSWORD</code> in the Vercel project&apos;s environment variables before real users are on the site.
          </p>
        )}

        {/* ---------------------------------------------------------- Overview */}
        <section id="overview" className="scroll-mt-24">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white">Overview</h1>
              <p className="mt-1 text-sm text-zinc-500">Every account, card and dollar on CardFlip, right now.</p>
            </div>
            <span className="text-xs text-zinc-600">{new Date().toLocaleString()}</span>
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

        {/* ---------------------------------------------------------- Switches */}
        <section id="switches" className="scroll-mt-24">
          <h2 className="mb-3 text-lg font-semibold text-white">Switches</h2>
          <div className="rounded-2xl border border-edge bg-surface-1 p-4">
            <FeatureToggles magicPublic={magicOn} />
          </div>
        </section>

        {/* ------------------------------------------------------------- Users */}
        <section id="users" className="scroll-mt-24">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Users <span className="text-sm font-normal text-zinc-500">({users.length})</span></h2>
              <p className="mt-0.5 text-xs text-zinc-500">Tap a row for plan, reset link, role and delete. Add account creates a seller by hand.</p>
            </div>
          </div>
          <AdminUsersTable users={users} rollups={o.userRollups} />
        </section>

        {/* ------------------------------------------------------------- Cards */}
        <section id="cards" className="scroll-mt-24">
          <h2 className="mb-3 text-lg font-semibold text-white">Recent cards <span className="text-sm font-normal text-zinc-500">(latest {cards.length})</span></h2>
          <div className="overflow-x-auto rounded-2xl border border-edge bg-surface-1">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Card</th>
                  <th className="px-4 py-3 font-medium">Game</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">eBay</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => {
                  const owner = userById.get(c.userId);
                  const displayPrice = c.status === "sold" ? c.soldPrice : c.price;
                  return (
                    <tr key={c.id} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium text-white">{c.cardName}</span>
                        <span className="ml-2 text-xs text-zinc-500">{c.setName} · {c.cardNumber}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400">{c.game === "mtg" ? "Magic" : "Pokémon"}</td>
                      <td className="px-4 py-3 text-zinc-400">{owner?.name ?? "Unknown"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>{c.status}</span></td>
                      <td className="px-4 py-3 text-xs">
                        {c.ebayListingId ? <span className="text-emerald-400">live</span> : c.ebayOfferId ? <span className="text-sky-300">draft</span> : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-white">{money(displayPrice ?? 0)}</td>
                      <td className="px-4 py-3 text-zinc-500">{fmtDate(c.updatedAt)}</td>
                    </tr>
                  );
                })}
                {cards.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-500">No cards scanned yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {/* ------------------------------------------------------ Prices & data */}
        <section id="data" className="scroll-mt-24">
          <h2 className="mb-3 text-lg font-semibold text-white">Prices &amp; data</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-edge bg-surface-1 p-4 lg:col-span-2">
              <p className="mb-3 text-sm font-medium text-zinc-200">Daily price refresh</p>
              <DailyJobControl initial={o.data.daily} />
            </div>
            <div className="rounded-2xl border border-edge bg-surface-1 p-4">
              <p className="mb-3 text-sm font-medium text-zinc-200">Price history</p>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-zinc-500">Series total</dt><dd className="text-right tabular-nums text-white">{num(o.data.priceSeries.total)}</dd>
                <dt className="text-zinc-500">Pokémon</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.priceSeries.pokemon)}</dd>
                <dt className="text-zinc-500">Magic</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.priceSeries.mtg)}</dd>
                <dt className="text-zinc-500">Latest point</dt><dd className="text-right text-zinc-300">{o.data.priceSeries.latestDay ?? "—"}</dd>
                <dt className="text-zinc-500">TCGplayer map</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.tcgplayerMap)}</dd>
              </dl>
            </div>
            <div className="rounded-2xl border border-edge bg-surface-1 p-4">
              <p className="mb-3 text-sm font-medium text-zinc-200">Catalogue mirrors</p>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-zinc-500">Pokémon EN</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.enCards)}</dd>
                <dt className="text-zinc-500">Pokémon JA / ZH</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.jpCards)} / {num(o.data.zhCards)}</dd>
                <dt className="text-zinc-500">Magic printings</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.mtgCards)}</dd>
                <dt className="text-zinc-500">Magic sets</dt><dd className="text-right tabular-nums text-zinc-300">{num(o.data.mtgSets)}</dd>
                <dt className="text-zinc-500">Magic synced</dt><dd className="text-right text-zinc-300">{fmtDate(o.data.mtgSyncedAt)}</dd>
              </dl>
            </div>
            <div className="rounded-2xl border border-edge bg-surface-1 p-4 lg:col-span-2">
              <p className="mb-3 text-sm font-medium text-zinc-200">Storage</p>
              <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
                <div><dt className="text-zinc-500">SQLite (incl. WAL)</dt><dd className="text-white">{bytes(o.data.dbBytes)}</dd></div>
                <div><dt className="text-zinc-500">Seed marker</dt><dd className="truncate text-zinc-300" title={o.data.seedMarker ?? ""}>{o.data.seedMarker ? `v${o.data.seedMarker.split(":v")[1] ?? "?"} · imported` : "not imported"}</dd></div>
                <div><dt className="text-zinc-500">Refresh cadence</dt><dd className="text-zinc-300">every ~20 h</dd></div>
                <div><dt className="text-zinc-500">Sources</dt><dd className="text-zinc-300">Scryfall bulk · TCGCSV · pokemontcg.io</dd></div>
              </dl>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ Errors */}
        <section id="errors" className="scroll-mt-24">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-white">Errors</h2>
            <span className={`text-xs ${errors24h ? "text-amber-300" : "text-zinc-500"}`}>
              {errors24h ? `${num(errors24h)} in the last 24h` : "none in the last 24h"} · 30-day retention
            </span>
          </div>
          <div className="rounded-2xl border border-edge bg-surface-1">
            {recentErrors.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">
                No server errors recorded — unhandled route errors land here automatically.
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {recentErrors.map((e) => (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <code className="text-xs text-zinc-400">{e.source}</code>
                      <span className="text-[11px] text-zinc-600">{fmtDate(e.at)}{e.digest && ` · ${e.digest}`}</span>
                    </div>
                    <p className="mt-1 text-sm text-red-300">{e.message}</p>
                    {e.stack && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-zinc-600 hover:text-zinc-400">stack</summary>
                        <pre className="mt-1 overflow-x-auto rounded-lg bg-black/30 p-2 text-[11px] leading-snug text-zinc-500">{e.stack}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------------ System */}
        <section id="system" className="scroll-mt-24">
          <h2 className="mb-3 text-lg font-semibold text-white">System</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-edge bg-surface-1 p-4 lg:col-span-2">
              <p className="mb-3 text-sm font-medium text-zinc-200">Integrations</p>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {o.system.env.map((e) => (
                  <li key={e.name} className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-sm">
                    <span className="text-zinc-300">{e.name}{e.note && <span className="ml-2 text-[11px] text-zinc-600">{e.note}</span>}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${e.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-zinc-500"}`}>{e.ok ? "configured" : "off"}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-edge bg-surface-1 p-4">
              <p className="mb-3 text-sm font-medium text-zinc-200">Process</p>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-zinc-500">Node</dt><dd className="text-right text-zinc-300">{o.system.node}</dd>
                <dt className="text-zinc-500">Uptime</dt><dd className="text-right text-zinc-300">{uptime(o.system.uptimeSec)}</dd>
                <dt className="text-zinc-500">Memory (RSS)</dt><dd className="text-right text-zinc-300">{bytes(o.system.rssBytes)}</dd>
                <dt className="text-zinc-500">Cron endpoint</dt><dd className="text-right text-zinc-300"><code className="text-[11px]">/api/cron/daily</code></dd>
              </dl>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
