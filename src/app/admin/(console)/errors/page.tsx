import { fmtDate, num } from "@/components/admin/format";
import { errorCount24h, listRecentErrors } from "@/lib/server/errorLog";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

export default async function AdminErrorsPage() {
  await requireOwnerPage();
  const [recent, errors24h] = await Promise.all([listRecentErrors(200), errorCount24h()]);
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-white">Server Log</h1>
        <span className={`text-xs ${errors24h ? "text-amber-300" : "text-zinc-500"}`}>
          {errors24h ? `${num(errors24h)} errors in the last 24h` : "no errors in the last 24h"} · newest 500 lines kept
        </span>
      </div>
      <div className="rounded-2xl border border-edge bg-surface-1">
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            Nothing logged — unhandled route errors and every server console.warn / console.error land here automatically.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {recent.map((e) => {
              const warn = e.level === "warn";
              return (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          warn ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300"
                        }`}
                      >
                        {warn ? "Warn" : "Error"}
                      </span>
                      <code className="text-xs text-zinc-400">{e.source}</code>
                    </span>
                    <span className="text-[11px] text-zinc-600">{fmtDate(e.at)}{e.digest && ` · ${e.digest}`}</span>
                  </div>
                  <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${warn ? "text-amber-200/90" : "text-red-300"}`}>
                    {e.message}
                  </p>
                  {e.stack && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-zinc-600 hover:text-zinc-400">stack</summary>
                      <pre className="mt-1 overflow-x-auto rounded-lg bg-black/30 p-2 text-[11px] leading-snug text-zinc-500">{e.stack}</pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
