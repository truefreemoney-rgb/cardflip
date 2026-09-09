import { fmtDate, num } from "@/components/admin/format";
import { errorCount24h, listRecentErrors } from "@/lib/server/errorLog";

export const dynamic = "force-dynamic";

export default async function AdminErrorsPage() {
  const [recentErrors, errors24h] = await Promise.all([listRecentErrors(50), errorCount24h()]);
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-white">Errors</h1>
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
  );
}
