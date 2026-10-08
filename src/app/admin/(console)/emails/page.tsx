import { requireOwnerPage } from "@/lib/server/adminPage";
import { campaignOverview, SAME_GAP_DAYS } from "@/lib/server/campaigns";
import EmailCampaignControls, { EmailTestButton, SendNowButton } from "@/components/admin/EmailCampaignControls";
import { etDateTime } from "@/lib/time";
import { num } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /admin/emails — the three weekly mails (lib/server/campaigns.ts, docs/EMAILS.md). The switch, who each mail
 * reaches, a preview of every version, a test send of each to the owner, and the send log.
 */
export default async function AdminEmailsPage() {
  await requireOwnerPage();
  const o = await campaignOverview();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-20">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Emails</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Three mails a week: Scans on Tuesday 10am, Your cards on Thursday 10am, This week in cards on Sunday 6:30pm (Eastern). One mail per
          person per day, the same mail once every {SAME_GAP_DAYS} days. Accounts made before Oct 7 get none; you get a copy of each mail that goes out.
          Every card price in a mail passes the price guard; a card it can&apos;t vouch for is left out.
        </p>
        {!o.mailConfigured && <p className="mt-2 text-sm text-amber-300">Mail isn&apos;t set up on this server, so nothing can send here.</p>}
      </div>

      <EmailCampaignControls on={o.on} />

      {o.campaigns.map((c) => (
        <section key={c.id} className="overflow-hidden rounded-2xl border border-edge bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2.5">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">{c.label}</h2>
              <p className="text-xs text-zinc-500">{c.when}</p>
            </div>
            <SendNowButton id={c.id} label={c.label} on={o.on} />
          </div>
          <div className="grid grid-cols-3 gap-2 border-b border-edge px-3 py-2.5 text-center text-sm">
            <div>
              <p className="font-semibold tabular-nums text-white">{num(c.eligible)}</p>
              <p className="text-xs text-zinc-500">Could get it</p>
            </div>
            <div>
              <p className="font-semibold tabular-nums text-white">{num(c.dueNext)}</p>
              <p className="text-xs text-zinc-500">Due next run</p>
            </div>
            <div>
              <p className="font-semibold tabular-nums text-white">{num(c.sent)}</p>
              <p className="text-xs text-zinc-500">Sent so far</p>
            </div>
          </div>
          {c.variants.map((v) => (
            <div key={v.key} className="border-b border-edge px-3 py-2.5 last:border-b-0">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    {v.label}
                    {v.count != null && <span className="ml-2 text-xs text-zinc-500">{num(v.count)} due</span>}
                  </p>
                  <p className="text-xs text-zinc-500">Subject: {v.preview.subject}</p>
                </div>
                <EmailTestButton id={v.key} />
              </div>
              <iframe
                title={`${c.label} · ${v.label} preview`}
                srcDoc={`<body style="margin:0;padding:12px;font-family:system-ui,sans-serif;font-size:15px;color:#111;background:#fff">${v.preview.html}</body>`}
                sandbox=""
                className="h-96 w-full rounded-lg border border-edge bg-white"
              />
            </div>
          ))}
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
                  {r.campaign} · <span className={r.status === "failed" ? "text-red-300" : r.status === "test" || r.status === "copy" ? "text-sky-300" : "text-emerald-300"}>{r.status}</span> · {etDateTime(r.sentAt)}
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
