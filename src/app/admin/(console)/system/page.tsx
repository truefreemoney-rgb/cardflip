import type { ReactNode } from "react";
import Link from "next/link";
import ActivityBars from "@/components/admin/ActivityBars";
import DailyJobControl from "@/components/admin/DailyJobControl";
import { ago, bytes, fmtDate, num, uptime } from "@/components/admin/format";
import { cronLabel } from "@/lib/cronSchedule";
import { getAdminOverview, perDay } from "@/lib/server/adminStats";
import { ERROR_DIGEST_MIN } from "@/lib/server/errorDigest";
import { errorCount24h, errorGroups24h } from "@/lib/server/errorLog";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

/**
 * The ops page: what is deployed, what it runs on, what the database holds,
 * whether the nightly job ran, and what has been failing. Everything here is
 * read from state the console already gathers — no new probes, and nothing
 * that costs a whole-table walk on Turso (09-06 rows-read outage).
 */

/** A price-history day older than this is worth an amber flag: the cron missed. */
const STALE_POINT_DAYS = 2;

function Card({ title, right, span, children }: { title: string; right?: ReactNode; span?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-edge bg-surface-1 p-4 ${span ?? ""}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        {right && <span className="text-[11px] text-zinc-500">{right}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Label/value pairs. Each list is its own two-column grid so a right-aligned
 * value can never run into the next label — the four-column layout on the
 * Database card did exactly that ("292.7 MBPrice points", issue #17).
 */
function Pairs({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <div>
      {heading && <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-600">{heading}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>
    </div>
  );
}

function Row({ label, tone, children }: { label: string; tone?: "warn"; children: ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`min-w-0 truncate text-right ${tone === "warn" ? "text-amber-300" : "text-zinc-300"}`}>{children}</dd>
    </>
  );
}

function daysSince(isoDay: string, now: number): number {
  return Math.floor((now - Date.parse(`${isoDay}T00:00:00Z`)) / 86_400_000);
}

export default async function AdminSystemPage() {
  await requireOwnerPage();
  const [o, errors24h, errorDays, groups] = await Promise.all([
    getAdminOverview(),
    errorCount24h(),
    perDay("error_events", "at", 14),
    errorGroups24h(5),
  ]);
  const { now } = o;
  const { deploy } = o.system;
  const d = o.data;
  const errors7d = errorDays.values.slice(-7).reduce((a, b) => a + b, 0);
  const commitUrl = deploy.sha && deploy.repo ? `https://github.com/${deploy.repo}/commit/${deploy.sha}` : null;
  const builtAtMs = deploy.builtAt ? Date.parse(deploy.builtAt) : null;
  const pointStale = d.priceSeries.latestDay ? daysSince(d.priceSeries.latestDay, now) > STALE_POINT_DAYS : false;
  const nextCron = o.system.crons
    .filter((c) => c.nextAt !== null)
    .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))[0];

  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-white">System</h1>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card
          title="Build"
          span="lg:col-span-2"
          right={deploy.target ? `${deploy.target} · Vercel` : "local dev"}
        >
          <Pairs>
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
            <Row label="Built">{builtAtMs ? `${fmtDate(builtAtMs)} · ${ago(builtAtMs, now)}` : "—"}</Row>
            <Row label="Region">{deploy.region ?? "—"}</Row>
          </Pairs>
          {deploy.message && <p className="mt-3 truncate text-xs text-zinc-500" title={deploy.message}>{deploy.message}</p>}
        </Card>

        <Card title="Process" right={o.system.vercel ? "this function instance" : "long-lived server"}>
          <Pairs>
            <Row label="Node">{o.system.node}</Row>
            <Row label="Runtime">{o.system.runtime} · {o.system.platform}</Row>
            <Row label="Instance uptime">{uptime(o.system.uptimeSec)}</Row>
            <Row label="Memory (RSS)">{bytes(o.system.rssBytes)}</Row>
            <Row label="Heap">{bytes(o.system.heapUsedBytes)} / {bytes(o.system.heapTotalBytes)}</Row>
          </Pairs>
          {o.system.vercel && (
            <p className="mt-3 text-[11px] text-zinc-600">
              Every request can land on a fresh instance, so uptime and memory describe the one that rendered this page.
            </p>
          )}
        </Card>

        <Card
          title="Daily refresh"
          span="lg:col-span-3"
          right={`started ${fmtDate(d.daily.startedAt)} · finished ${fmtDate(d.daily.finishedAt)}`}
        >
          <DailyJobControl initial={d.daily} now={now} />
          <div className="mt-3 border-t border-white/5 pt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-600">Schedule</p>
            {o.system.vercel ? (
              <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
                {o.system.crons.map((c) => (
                  <li key={c.path}>
                    <code className="text-[11px] text-zinc-300">{c.path}</code>
                    <span className="ml-2">{cronLabel(c.schedule)}</span>
                    {c.nextAt && <span className="ml-2 text-zinc-600">next {fmtDate(c.nextAt)}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-400">
                Not on Vercel: an in-process hourly tick runs the whole job when it is due. The Vercel crons
                {o.system.crons.map((c) => (
                  <span key={c.path}>
                    {" "}<code className="text-[11px] text-zinc-300">{c.path}</code> ({cronLabel(c.schedule)})
                  </span>
                ))}{" "}
                only fire on a deploy.
              </p>
            )}
            {o.system.vercel && nextCron?.nextAt && (
              <p className="mt-1 text-[11px] text-zinc-600">
                Next half fires in {uptime(Math.max(0, Math.round((nextCron.nextAt - now) / 1000)))}. The Magic half stamps
                &ldquo;finished&rdquo;; the Pokémon half only records its steps.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Database"
          span="lg:col-span-2"
          right={o.system.dbRemote ? "Turso (remote libSQL)" : "local file · data/cardflip.db"}
        >
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Pairs heading="Catalogue">
              <Row label="Pokémon EN">{num(d.enCards)}</Row>
              <Row label="Pokémon JA">{num(d.jpCards)}</Row>
              <Row label="Pokémon ZH">{num(d.zhCards)}</Row>
              <Row label="Magic cards">{num(d.mtgCards)} · {num(d.mtgSets)} sets</Row>
              <Row label="Magic synced">{d.mtgSyncedAt ? `${fmtDate(d.mtgSyncedAt)} · ${ago(d.mtgSyncedAt, now)}` : "—"}</Row>
              <Row label="TCGplayer map">{num(d.tcgplayerMap)}</Row>
              {d.seedMarker && <Row label="MTG seed">{d.seedMarker}</Row>}
            </Pairs>
            <Pairs heading="Price history">
              <Row label="Points">{num(d.priceSeries.total)}</Row>
              <Row label="Pokémon">{num(d.priceSeries.pokemon)}</Row>
              <Row label="Magic">{num(d.priceSeries.mtg)}</Row>
              <Row label="Latest day" tone={pointStale ? "warn" : undefined}>
                {d.priceSeries.latestDay ?? "—"}{pointStale && " · stale"}
              </Row>
              <Row label="Size">{d.dbBytes ? bytes(d.dbBytes) : "—"}</Row>
            </Pairs>
          </div>
          <p className="mt-3 text-[11px] text-zinc-600">
            Catalogue counts are memoed for six hours — they only move on a sync.
            {pointStale && ` The latest price point is more than ${STALE_POINT_DAYS} days old, so the daily refresh has been missing.`}
          </p>
        </Card>

        <Card
          title="Errors"
          right={
            <>
              {num(errors24h)} / 24h · {num(errors7d)} / 7d ·{" "}
              <Link href="/admin/errors" className="text-brand-300 hover:underline">all</Link>
            </>
          }
        >
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
          <p className="mt-2 text-[11px] text-zinc-600">
            A digest is mailed after the Pokémon cron when the 24h count passes {ERROR_DIGEST_MIN}.
          </p>
        </Card>

        <Card title="Integrations" span="lg:col-span-3" right="presence of each secret, never its value">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {o.system.env.map((e) => (
              <li key={e.name} className="flex items-center justify-between gap-3 rounded-lg bg-black/25 px-3 py-2 text-sm">
                <span className="min-w-0 text-zinc-300">
                  {e.name}
                  {e.note && <span className="ml-2 text-[11px] text-zinc-600">{e.note}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${e.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-zinc-500"}`}>{e.ok ? "configured" : "off"}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}
