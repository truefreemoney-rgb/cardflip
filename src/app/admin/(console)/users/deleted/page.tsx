import { ago, money, num, TIER_STYLE } from "@/components/admin/format";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { listDeletedAccounts, type DeletedAccount } from "@/lib/server/deletedAccounts";
import { etDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const GRID = "md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,1.1fr)]";

function planLabel(d: DeletedAccount): string {
  if (!d.tier) return "Unknown";
  const label = d.tier === "subscribed" && d.plan === "pro" ? "Pro" : TIER_STYLE[d.tier].label;
  return d.tier === "subscribed" && d.subSource ? `${label} · ${d.subSource === "apple" ? "Apple" : "Stripe"}` : label;
}

function howLabel(d: DeletedAccount): string {
  if (!d.by) return "Deleted before Oct 31 (time not kept)";
  const who = d.by === "admin" ? "Deleted by admin" : d.via === "app" ? "Deleted by them in the app" : "Deleted by them on the website";
  return d.confirmed === false ? `${who} · email never confirmed` : who;
}

/** "$4.99 · 1 Booster" / "1 test Booster ($0)" / "—". */
function paidParts(d: DeletedAccount): { real: string | null; test: string | null } {
  const real: string[] = [];
  if (d.boosters) real.push(`${d.boosters} Booster${d.boosters === 1 ? "" : "s"}`);
  if (d.subPayments) real.push(`${d.subPayments} plan payment${d.subPayments === 1 ? "" : "s"}`);
  const tests = d.testBoosters + d.testSubPayments;
  return {
    real: real.length ? real.join(" · ") : null,
    test: tests ? `${tests} Apple test purchase${tests === 1 ? "" : "s"} ($0.00)` : null,
  };
}

/**
 * /admin/users/deleted (Chris 10-31, after two TestFlight Boosters showed in the stats from accounts already gone):
 * every deleted account with what was kept, newest first. No names or emails: a delete keeps neither (the privacy
 * page), so an account is its short id. Built in lib/server/deletedAccounts.ts. Server-rendered, no API route.
 */
export default async function AdminDeletedUsersPage() {
  await requireOwnerPage();
  // "3 h ago" is measured from when the list was read.
  const { accounts: list, now } = await listDeletedAccounts();
  const paidTotal = list.reduce((s, d) => s + d.paidUsd, 0);
  return (
    <section>
      <div className="mb-3">
        <h1 className="text-2xl font-semibold text-white">
          Deleted Accounts <span className="text-sm font-normal text-zinc-500">({list.length})</span>
        </h1>
        <p className="mt-0.5 text-xs text-zinc-500">
          No name or email is kept after a delete (privacy page), so each account shows by its ID. Apple test purchases (TestFlight, App Review) cost nothing.
          {paidTotal > 0 ? (
            <>
              {" "}Real money from these accounts: <span className="font-semibold text-emerald-300">{money(paidTotal)}</span>.
            </>
          ) : null}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
        <div className={`hidden items-center gap-3 border-b border-edge px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 md:grid ${GRID}`}>
          <span>Account</span>
          <span>Plan</span>
          <span>Deleted</span>
          <span>Made</span>
          <span className="text-right">Scans</span>
          <span>Paid</span>
        </div>
        <ul className="divide-y divide-edge">
          {list.map((d) => {
            const paid = paidParts(d);
            const tier = d.tier ? TIER_STYLE[d.tier] : null;
            return (
              <li key={d.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 md:items-center ${GRID}`}>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm font-medium text-white" title={d.id}>
                    {d.id.slice(0, 8)}
                  </span>
                  <span className="block text-xs text-zinc-500">{howLabel(d)}</span>
                  {/* Phone: the other columns fold under the account. */}
                  <span className="mt-0.5 block text-[11px] text-zinc-300 md:hidden">
                    {d.deletedAt ? `Deleted ${ago(d.deletedAt, now)} · ${etDateTime(d.deletedAt)}` : d.lastScanAt ? `Last scan ${etDateTime(d.lastScanAt)}` : "Delete time not kept"}
                  </span>
                  <span className="block text-[11px] text-zinc-500 md:hidden">
                    Made {d.createdAt ? etDateTime(d.createdAt) : "—"} · {num(d.scans)} {d.scans === 1 ? "scan" : "scans"}
                  </span>
                  {paid.real || paid.test ? (
                    <span className="block text-[11px] md:hidden">
                      {paid.real ? (
                        <span className="text-zinc-300">
                          <span className="font-semibold text-emerald-300">{money(d.paidUsd)}</span> {paid.real}
                        </span>
                      ) : null}
                      {paid.real && paid.test ? <span className="text-zinc-600"> · </span> : null}
                      {paid.test ? <span className="text-zinc-500">{paid.test}</span> : null}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-col items-end gap-1 md:items-start">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tier ? tier.cls : "bg-white/5 text-zinc-500"}`}>{planLabel(d)}</span>
                </span>
                <span className="hidden min-w-0 md:block">
                  {d.deletedAt ? (
                    <>
                      <span className="block text-xs text-zinc-300">{ago(d.deletedAt, now)}</span>
                      <span className="block truncate text-[11px] text-zinc-600">{etDateTime(d.deletedAt)}</span>
                    </>
                  ) : (
                    <>
                      <span className="block text-xs text-zinc-500">Before Oct 31</span>
                      {d.lastScanAt ? <span className="block truncate text-[11px] text-zinc-600">Last scan {etDateTime(d.lastScanAt)}</span> : null}
                    </>
                  )}
                </span>
                <span className="hidden truncate text-xs text-zinc-400 md:block">{d.createdAt ? etDateTime(d.createdAt) : "—"}</span>
                <span className={`hidden text-right tabular-nums md:block ${d.scans ? "text-zinc-300" : "text-zinc-600"}`}>{num(d.scans)}</span>
                <span className="hidden min-w-0 text-xs md:block">
                  {paid.real ? (
                    <span className="block truncate text-zinc-300">
                      <span className="font-semibold text-emerald-300">{money(d.paidUsd)}</span> {paid.real}
                    </span>
                  ) : null}
                  {paid.test ? <span className="block truncate text-[11px] text-zinc-500">{paid.test}</span> : null}
                  {!paid.real && !paid.test ? <span className="text-zinc-600">—</span> : null}
                </span>
              </li>
            );
          })}
          {list.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">No deleted accounts.</li>}
        </ul>
      </div>
      {list.length >= 500 && <p className="mt-2 text-[11px] text-zinc-600">Showing the latest 500.</p>}
    </section>
  );
}
