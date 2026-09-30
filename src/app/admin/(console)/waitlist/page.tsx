import { fmtDate, num } from "@/components/admin/format";
import { requireOwnerPage } from "@/lib/server/adminPage";
import { waitlistSummary } from "@/lib/server/waitlist";
import { countryName } from "@/lib/countries";

export const dynamic = "force-dynamic";

/** Who asked to be told when CardFlip opens in their country (/unavailable, 09-30). */
export default async function AdminWaitlistPage() {
  await requireOwnerPage();
  const { total, byCountry, recent } = await waitlistSummary();
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-white">Waitlist</h1>
        <span className="text-xs text-zinc-500">{num(total)} {total === 1 ? "email" : "emails"}</span>
      </div>
      {total === 0 ? (
        <p className="rounded-2xl border border-edge bg-surface-1 px-4 py-6 text-center text-sm text-zinc-500">
          No one yet. Visitors outside US, CA, GB, IE, AU and NZ can leave an email on the Not Available screen.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {byCountry.map((c) => (
              <span key={c.country} className="rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-300">
                {countryName(c.country) ?? c.country} <span className="text-zinc-500">{num(Number(c.count))}</span>
              </span>
            ))}
          </div>
          <div className="rounded-2xl border border-edge bg-surface-1">
            <ul className="divide-y divide-white/5">
              {recent.map((r) => (
                <li key={r.email} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5">
                  <span className="break-all text-sm text-zinc-200">{r.email}</span>
                  <span className="text-[11px] text-zinc-500">
                    {countryName(r.country) ?? r.country} · {fmtDate(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
