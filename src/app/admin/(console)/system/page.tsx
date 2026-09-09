import { bytes, uptime } from "@/components/admin/format";
import { getAdminOverview } from "@/lib/server/adminStats";

export const dynamic = "force-dynamic";

export default async function AdminSystemPage() {
  const o = await getAdminOverview();
  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-white">System</h1>
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
  );
}
