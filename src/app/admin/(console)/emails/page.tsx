import { requireOwnerPage } from "@/lib/server/adminPage";
import { campaignOverview, MAX_PER_CAMPAIGN, MIN_GAP_DAYS, SAME_GAP_DAYS } from "@/lib/server/campaigns";
import EmailCampaignControls, { EmailTestButton } from "@/components/admin/EmailCampaignControls";
import { etDateTime } from "@/lib/time";
import { num } from "@/components/admin/format";

export const dynamic = "force-dynamic";

/**
 * /admin/emails — admin email campaigns (lib/server/campaigns.ts, Chris 10-07). The switch, who each
 * mail would reach, a preview of each mail, a test send to the owner, and the send log. The Sunday
 * digest (digest.ts) is separate and keeps its own schedule.
 */
export default async function AdminEmailsPage() {
  await requireOwnerPage();
  const o = await campaignOverview();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-20">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Emails</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Sends on {o.sendDays.join(" and ")} (Eastern) with the morning daily job. Each free-trial user gets the one mail that fits them.
          Caps: {MIN_GAP_DAYS} days between mails, the same mail once every {SAME_GAP_DAYS} days, {MAX_PER_CAMPAIGN} of one mail ever. Paying users get none.
          The Sunday digest is separate. The unsubscribe link stops both.
        </p>
        {!o.mailConfigured && <p className="mt-2 text-sm text-amber-300">Mail isn&apos;t set up on this server, so nothing can send here.</p>}
      </div>

      <EmailCampaignControls on={o.on} />

      {o.campaigns.map((c) => (
        <section key={c.id} className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2.5">
            <h2 className="font-display text-lg font-semibold text-white">{c.label}</h2>
            <EmailTestButton id={c.id} />
          </div>
          <div className="grid grid-cols-3 gap-2 border-b border-edge px-3 py-2.5 text-center text-sm">
            <div>
              <p className="font-semibold tabular-nums text-white">{num(c.eligible)}</p>
              <p className="text-xs text-zinc-500">Fit this mail</p>
            </div>
            <div>
              <p className="font-semibold tabular-nums text-white">{num(c.dueNext)}</p>
              <p className="text-xs text-zinc-500">Would get it next run</p>
            </div>
            <div>
              <p className="font-semibold tabular-nums text-white">{num(c.sent)}</p>
              <p className="text-xs text-zinc-500">Sent so far</p>
            </div>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-xs text-zinc-500">Subject</p>
            <p className="mb-2 text-sm font-medium text-white">{c.preview.subject}</p>
            <iframe
              title={`${c.label} preview`}
              srcDoc={`<body style="margin:0;padding:12px;font-family:system-ui,sans-serif;font-size:15px;color:#111;background:#fff">${c.preview.html}</body>`}
              sandbox=""
              className="h-80 w-full rounded-lg border border-edge bg-white"
            />
          </div>
        </section>
      ))}

      <section className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
        <h2 className="border-b border-edge px-3 py-2.5 font-display text-lg font-semibold text-white">Send Log</h2>
        {o.log.length === 0 ? (
          <p className="px-3 py-3 text-sm text-zinc-500">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-edge text-sm">
            {o.log.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
                <span className="min-w-0 truncate text-zinc-200">{r.email}</span>
                <span className="text-xs text-zinc-500">
                  {r.campaign} · <span className={r.status === "failed" ? "text-red-300" : r.status === "test" ? "text-sky-300" : "text-emerald-300"}>{r.status}</span> · {etDateTime(r.sentAt)}
                </span>
                {r.error && <span className="w-full text-xs text-red-300">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
