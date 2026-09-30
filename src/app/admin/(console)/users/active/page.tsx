import Link from "next/link";
import { ago, TIER_STYLE } from "@/components/admin/format";
import { ACTIVE_WINDOWS, activeIn, activeUsers, parseActiveWindow, type ActiveUser, type ActiveWindow } from "@/lib/server/activeUsers";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { etDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const GRID = "md:grid-cols-[minmax(0,2fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_4rem]";

const PHRASE: Record<ActiveWindow, string> = {
  today: "today (since midnight ET)",
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
};

const EMPTY: Record<ActiveWindow, string> = {
  today: "Nobody yet today.",
  "7d": "Nobody in the last 7 days.",
  "30d": "Nobody in the last 30 days.",
};

function planLabel(u: ActiveUser): string {
  return u.tier === "subscribed" && u.plan === "pro" ? "Pro" : TIER_STYLE[u.tier].label;
}

/**
 * /admin/users/active (Chris 09-30): who opened the app or did something in
 * the window, latest first. What counts, and what deliberately does not, is
 * in lib/server/activeUsers.ts. Server-rendered, no API route.
 */
export default async function AdminActiveUsersPage({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  await requireOwnerPage();
  const win = parseActiveWindow((await searchParams).window);
  const snap = await activeUsers();
  const { users, staffHidden } = activeIn(snap, win);
  // "3 h ago" is measured from when the (up to 60 s old) snapshot was read,
  // the same instant its windows were cut from.
  const now = snap.now;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Active Users <span className="text-sm font-normal text-zinc-500">({users.length})</span>
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            Opened the app or did something {PHRASE[win]}.{staffHidden > 0 ? ` ${staffHidden} staff hidden.` : ""}
          </p>
        </div>
        <nav aria-label="Window" className="flex w-full items-center gap-1 rounded-full border border-edge bg-surface-1 p-1 text-xs sm:w-auto">
          {ACTIVE_WINDOWS.map((w) => (
            <Link
              key={w.id}
              href={w.id === "7d" ? "/admin/users/active" : `/admin/users/active?window=${w.id}`}
              aria-current={w.id === win ? "page" : undefined}
              className={`flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-center transition sm:flex-none ${w.id === win ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
            >
              {w.label} <span className="tabular-nums text-zinc-500">({activeIn(snap, w.id).users.length})</span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
        <div className={`hidden items-center gap-3 border-b border-edge px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 md:grid ${GRID}`}>
          <span>User</span>
          <span>Plan</span>
          <span>Last Active</span>
          <span>What They Did</span>
          <span className="text-right">Scans</span>
        </div>
        <ul className="divide-y divide-edge">
          {users.map((u) => {
            const scans = u.scans[win];
            return (
              <li key={u.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 ${GRID}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{u.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{u.email}</span>
                  {/* Phone: the Last Active and What They Did columns fold under the name. */}
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-300 md:hidden">
                    {u.what} · {ago(u.activeAt, now)}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-600 md:hidden">{etDateTime(u.activeAt)}</span>
                </span>
                <span className="flex flex-col items-end gap-1 md:items-start">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TIER_STYLE[u.tier].cls}`}>{planLabel(u)}</span>
                  <span className="text-[11px] tabular-nums text-zinc-500 md:hidden">
                    {scans} {scans === 1 ? "scan" : "scans"}
                  </span>
                </span>
                <span className="hidden min-w-0 md:block">
                  <span className="block text-xs text-zinc-300">{ago(u.activeAt, now)}</span>
                  <span className="block truncate text-[11px] text-zinc-600">{etDateTime(u.activeAt)}</span>
                </span>
                <span className="hidden truncate text-xs text-zinc-300 md:block">{u.what}</span>
                <span className={`hidden text-right tabular-nums md:block ${scans ? "text-zinc-300" : "text-zinc-600"}`}>{scans}</span>
              </li>
            );
          })}
          {users.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">{EMPTY[win]}</li>}
        </ul>
      </div>
      {users.length >= 500 && <p className="mt-2 text-[11px] text-zinc-600">Showing the latest 500.</p>}
    </section>
  );
}
