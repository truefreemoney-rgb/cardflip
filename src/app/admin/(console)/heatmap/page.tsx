import Link from "next/link";
import HeatFrame from "@/components/admin/HeatFrame";
import RangeDates from "@/components/admin/RangeDates";
import { num } from "@/components/admin/format";
import { parseWindow, RANGES, type CustomWindow } from "@/lib/server/analytics";
import { getHeatmap, type Count } from "@/lib/server/heatmap";
import { requireOwnerPage } from "@/lib/server/adminPage";
import type { HeatDevice } from "@/lib/heatmap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOUR_MS = 3_600_000;

/** [since, end) of the picked range: the custom dates, else the preset back from now. */
function windowBounds(custom: CustomWindow | null, range: string, now = Date.now()): { since: number; end: number } {
  if (custom) return { since: custom.since, end: custom.end };
  return { since: now - RANGES.find((r) => r.id === range)!.hours * HOUR_MS, end: now + 1 };
}

/**
 * /admin/heatmap (10-18, Chris: "where users fall off and where they click and
 * go the most"). Same range switch as /admin/analytics. Phone and computer are
 * separate maps (different layouts). Pick a page: the live page in a frame
 * with the taps painted on, then what people tapped, how far they scrolled,
 * where they came from and where they went next.
 */
export default async function AdminHeatmapPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; device?: string; page?: string }> }) {
  await requireOwnerPage();
  const params = await searchParams;
  const win = parseWindow(params);
  const custom = typeof win === "string" ? null : win;
  const range: string = typeof win === "string" ? win : "custom";
  const { since, end } = windowBounds(custom, range);
  const device: HeatDevice = params.device === "desktop" ? "desktop" : "phone";
  const h = await getHeatmap(since, end, device, typeof params.page === "string" ? params.page : null);
  const d = h.detail;

  const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const windowLabel = custom ? `${day(custom.from)} to ${day(custom.to)}` : `Last ${RANGES.find((r) => r.id === range)!.label}`;
  // Every link keeps the other choices: range (or dates), device, page.
  const href = (o: { range?: string; device?: HeatDevice; page?: string | null }) => {
    const q = new URLSearchParams();
    const r = o.range ?? range;
    if (r === "custom" && custom) {
      q.set("from", custom.from);
      q.set("to", custom.to);
    } else if (r !== "7d") q.set("range", r);
    const dev = o.device ?? device;
    if (dev !== "phone") q.set("device", dev);
    const p = o.page === undefined ? d?.page : o.page;
    if (p) q.set("page", p);
    const s = q.toString();
    return `/admin/heatmap${s ? `?${s}` : ""}`;
  };
  const dateBase = href({ range: "7d" }).replace(/&?(from|to)=[^&]*/g, "");
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <section className="pb-20 sm:pb-0">
      <div className="relative z-30 mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Heat map</h1>
          <p className="mt-1 text-sm text-zinc-500">{windowLabel}. Where people tap, how far they scroll, where they go next and where they leave.</p>
        </div>
        <RangePicker range={range} custom={custom} href={href} dateBase={dateBase} className="hidden sm:flex" />
      </div>

      <nav aria-label="Device" className="mb-4 flex gap-1 rounded-full border border-edge bg-surface-1 p-1 text-sm">
        {(["phone", "desktop"] as const).map((dev) => (
          <Link
            key={dev}
            href={href({ device: dev, page: null })}
            aria-current={dev === device ? "page" : undefined}
            className={`flex-1 rounded-full px-3 py-1.5 text-center transition ${dev === device ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
          >
            {dev === "phone" ? "Phone" : "Computer"}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-3 gap-3">
        <Tile>
          <Big>{num(h.visits)}</Big>
          <Label>Visits</Label>
        </Tile>
        <Tile>
          <Big>{num(h.pageViews)}</Big>
          <Label>Pages seen</Label>
        </Tile>
        <Tile>
          <Big className={h.visits && pct(h.oneAndDone, h.visits) >= 60 ? "text-rose-300" : undefined}>{pct(h.oneAndDone, h.visits)}%</Big>
          <Label>Left after one page</Label>
        </Tile>
      </div>

      {h.pages.length === 0 ? (
        <p className="mt-6 rounded-xl border border-edge bg-surface-1 px-4 py-3 text-sm text-zinc-400">
          No {device === "phone" ? "phone" : "computer"} visits recorded in this range yet. Recording started Oct 18.
        </p>
      ) : (
        <>
          <H2>Pages</H2>
          <Tile className="!p-0">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-b border-edge px-4 py-2 text-[11px] uppercase tracking-wide text-zinc-500">
              <span>Page</span>
              <span className="text-right">Views</span>
              <span className="text-right">Left here</span>
              <span className="text-right">Scrolled</span>
            </div>
            <ul>
              {h.pages.map((p) => {
                const on = p.page === d?.page;
                const left = pct(p.exits, p.views);
                return (
                  <li key={p.page}>
                    <Link
                      href={href({ page: p.page })}
                      aria-current={on ? "page" : undefined}
                      className={`grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-3 px-4 py-2 text-sm transition ${on ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5"}`}
                    >
                      <span className="truncate">{p.label}</span>
                      <span className="text-right tabular-nums">{num(p.views)}</span>
                      <span className={`text-right tabular-nums ${left >= 60 ? "text-rose-300" : "text-zinc-400"}`}>{left}%</span>
                      <span className="text-right tabular-nums text-zinc-400">{p.depth}%</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Tile>
          <p className="mt-1.5 text-[11px] text-zinc-600">Left here = the visit ended on this page. Scrolled = how far down, on average. Tap a page to see its map.</p>

          {d && (
            <>
              <H2>{d.label}</H2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Tile>
                  <HeatFrame src={d.samplePath} device={device} taps={d.taps} />
                  <p className="mt-2 text-[11px] text-zinc-600">
                    Showing {d.samplePath}. {num(d.tapCount)} tap{d.tapCount === 1 ? "" : "s"} on {num(d.views)} view{d.views === 1 ? "" : "s"}
                    {d.tapCount > d.taps.length ? `, newest ${num(d.taps.length)} drawn` : ""}.
                  </p>
                </Tile>
                <div className="space-y-3">
                  <Tile>
                    <p className="mb-2 text-sm font-medium text-zinc-200">Most tapped</p>
                    <Bars rows={d.topLabels} total={d.tapCount} color="#fb923c" empty="No taps on buttons or links yet." />
                    {d.deadTaps > 0 && (
                      <p className="mt-2 text-xs text-amber-300">
                        {num(d.deadTaps)} tap{d.deadTaps === 1 ? "" : "s"} ({pct(d.deadTaps, d.tapCount)}%) hit nothing tappable: people expected something to happen there.
                      </p>
                    )}
                  </Tile>
                  <Tile>
                    <p className="mb-2 text-sm font-medium text-zinc-200">How far down they got</p>
                    <ul className="space-y-1.5 text-xs">
                      {d.reach.map((r) => (
                        <li key={r.mark}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-zinc-200">{r.mark === 100 ? "The bottom" : `${r.mark}% down`}</span>
                            <span className="tabular-nums text-zinc-400">{r.pct}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(2, r.pct)}%`, background: "#a5b4fc", opacity: 0.85 }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Tile>
                  <Tile>
                    <p className="mb-2 text-sm font-medium text-zinc-200">Where they went next</p>
                    <Bars rows={d.next} total={d.views} color="#34d399" empty="No visits yet." />
                  </Tile>
                  <Tile>
                    <p className="mb-2 text-sm font-medium text-zinc-200">Where they came from</p>
                    <Bars rows={d.previous} total={d.views} color="#7dd3fc" empty="No visits yet." />
                  </Tile>
                </div>
              </div>
            </>
          )}

          <H2>Most common steps</H2>
          <Tile>
            {h.steps.length === 0 ? (
              <Empty>No one has gone from one page to another yet.</Empty>
            ) : (
              <Bars rows={h.steps.map((s) => ({ label: `${s.from} → ${s.to}`, n: s.n }))} total={0} color="#f0abfc" empty="" />
            )}
          </Tile>
        </>
      )}

      <div className="fixed inset-x-4 bottom-4 z-30 sm:hidden">
        <RangePicker range={range} custom={custom} href={href} dateBase={dateBase} up className="flex w-full justify-between shadow-lg shadow-black/40" />
      </div>
    </section>
  );
}

function RangePicker({ range, custom, href, dateBase, up = false, className = "" }: { range: string; custom: CustomWindow | null; href: (o: { range?: string }) => string; dateBase: string; up?: boolean; className?: string }) {
  return (
    <nav aria-label="Range" className={`items-center gap-1 rounded-full border border-edge bg-surface-1/95 p-1 text-xs backdrop-blur-md ${className}`}>
      <RangeDates from={custom?.from} to={custom?.to} active={custom !== null} up={up} base={dateBase} />
      {RANGES.map((r) => (
        <Link
          key={r.id}
          href={href({ range: r.id })}
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

function Bars({ rows, total, color, empty }: { rows: Count[]; total: number; color: string; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-1.5 text-xs">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-zinc-200">{r.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-400">
              {num(r.n)}
              {total ? <span className="text-zinc-600"> · {Math.round((r.n / total) * 100)}%</span> : null}
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
