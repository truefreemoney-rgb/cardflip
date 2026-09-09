import type { ReactNode } from "react";
import ActivityBars from "@/components/admin/ActivityBars";
import DailyJobControl from "@/components/admin/DailyJobControl";
import { bytes, fmtDate, num, uptime } from "@/components/admin/format";
import { getAdminOverview, perDay } from "@/lib/server/adminStats";
import { errorCount24h, errorGroups24h } from "@/lib/server/errorLog";

export const dynamic = "force-dynamic";

/**
 * The ops page: what is deployed, what it runs on, what the database holds,
 * whether the nightly job ran, and what has been failing. Everything here is
 * read from state the console already gathers — no new probes, and nothing
 * that costs a whole-table walk on Turso (09-06 rows-read outage).
 */

function Card({ title, right, span, children }: { title: string; right?: ReactNode; span?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-edge bg-surface-1 p-4 ${span ?? ""}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        {right && <span className="text-[11px] text-zinc-500">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-300">{children}</dd>
    </>
  );
}

export default async function AdminSystemPage() {
  const [o, errors24h, errorDays, groups] = await Promise.all([
    getAdminOverview(),
    errorCount24h(),
    perDay("error_events", "at", 14),
    errorGroups24h(5),
  ]);
  const { deploy } = o.system;
  const d = o.data;
  const errors7d = errorDays.values.slice(-7).reduce((a, b) => a + b, 0);
  const commitUrl = deploy.sha && deploy.repo ? `https://github.com/${deploy.repo}/commit/${deploy.sha}` : null;

  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-white">System</h1>

      {o.system.adminDefaults && (
        <p className="mb-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          This console is still on the default panel credentials. Set
          <code className="mx-1 text-[12px]">ADMIN_PANEL_USER</code> and
          <code className="mx-1 text-[12px]">ADMIN_PANEL_PASSWORD</code>.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card
          title="Build"
          span="lg:col-span-2"
          right={deploy.target ? deploy.target : "local dev"}
        >
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Row label="Commit">
              {deploy.sha ? (
                commitUrl ? (
                  <a href={commitUrl} target="_blank" rel="noreferrer" className="text-brand-300 hover:underline">
                    <code className="text-[12px]">{deploy.sha.slice(0, 7)}</code>
                  </a>
                ) : (
                  <code className="text-[12px]">{deploy.sha.slice(0, 7)}</code>
                )
              ) : (
                "—"
              )}
            </Row>
            <Row label="Branch">{deploy.branch ?? "—"}</Row>
            <Row label="Built">{deploy.builtAt ? fmtDate(Date.parse(deploy.builtAt)) : "—"}</Row>
            <Row label="Region">{deploy.region ?? "—"}</Row>
          </dl>
          {deploy.message && <p className="mt-3 truncate text-xs text-zinc-500" title={deploy.message}>{deploy.message}</p>}
        </Card>

        <Card title="Process">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Row label="Node">{o.system.node}</Row>
            <Row label="Runtime">{o.system.runtime} · {o.system.platform}</Row>
            <Row label="Uptime">{uptime(o.system.uptimeSec)}</Row>
            <Row label="Memory (RSS)">{bytes(o.system.rssBytes)}</Row>
            <Row label="Heap">{bytes(o.system.heapUsedBytes)} / {bytes(o.system.heapTotalBytes)}</Row>
            <Row label="Cron endpoint"><code className="text-[11px]">/api/cron/daily</code></Row>
          </dl>
        </Card>

        <Card
          title="Daily refresh"
          span="lg:col-span-3"
          right={`started ${fmtDate(d.daily.startedAt)} · finished ${fmtDate(d.daily.finishedAt)}`}
        >
          <DailyJobControl initial={d.daily} />
        </Card>

        <Card
          title="Database"
          span="lg:col-span-2"
          right={o.system.dbRemote ? "Turso (remote libSQL)" : "local file · data/cardflip.db"}
        >
          <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
            <Row label="Size">{d.dbBytes ? bytes(d.dbBytes) : "—"}</Row>
            <Row label="Price points">{num(d.priceSeries.total)}</Row>
            <Row label="Pokémon EN">{num(d.enCards)}</Row>
            <Row label="Pokémon points">{num(d.priceSeries.pokemon)}</Row>
            <Row label="Pokémon JA">{num(d.jpCards)}</Row>
            <Row label="Magic points">{num(d.priceSeries.mtg)}</Row>
            <Row label="Pokémon ZH">{num(d.zhCards)}</Row>
            <Row label="Latest point">{d.priceSeries.latestDay ?? "—"}</Row>
            <Row label="Magic cards">{num(d.mtgCards)} · {num(d.mtgSets)} sets</Row>
            <Row label="Magic synced">{fmtDate(d.mtgSyncedAt)}</Row>
            <Row label="TCGplayer map">{num(d.tcgplayerMap)}</Row>
            <Row label="MTG seed">{d.seedMarker ?? "—"}</Row>
          </dl>
          <p className="mt-3 text-[11px] text-zinc-600">
            Catalogue counts are memoed for six hours — they only move on a sync.
          </p>
        </Card>

        <Card title="Errors" right={`${num(errors24h)} / 24h · ${num(errors7d)} / 7d`}>
          <ActivityBars days={errorDays.days} values={errorDays.values} height={44} color="#f87171" />
          {groups.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">Nothing in the last 24h.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {groups.map((g) => (
                <li key={`${g.source}:${g.message}`} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <code className="truncate text-zinc-400" title={g.source}>{g.source}</code>
                    <span className="shrink-0 text-zinc-500">×{g.count}</span>
                  </div>
                  <p className="truncate text-red-300/80" title={g.message}>{g.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Integrations" span="lg:col-span-3">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {o.system.env.map((e) => (
              <li key={e.name} className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-sm">
                <span className="text-zinc-300">{e.name}{e.note && <span className="ml-2 text-[11px] text-zinc-600">{e.note}</span>}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${e.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-zinc-500"}`}>{e.ok ? "configured" : "off"}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}
