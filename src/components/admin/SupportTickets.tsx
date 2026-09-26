"use client";

import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";
import { fmtDate } from "@/components/admin/format";
import type { TicketWithUser } from "@/lib/server/supportTickets";

/** Admin ticket list: one row per ticket, Close / Reopen on each. */
export default function SupportTickets({ initial }: { initial: TicketWithUser[] }) {
  const [tickets, setTickets] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: "open" | "closed") {
    setPending(id);
    setError(null);
    try {
      const res = await fetch(apiPath(`/api/admin/tickets/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...data.ticket } : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the ticket");
    } finally {
      setPending(null);
    }
  }

  if (tickets.length === 0) {
    return (
      <div className="rounded-2xl border border-edge bg-surface-1 px-4 py-6 text-center text-sm text-zinc-500">
        No support tickets yet. Sellers open them from the robot (Help → Open a support ticket).
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-edge bg-surface-1">
      {error && <p className="px-4 pt-3 text-xs text-red-300">{error}</p>}
      <ul className="divide-y divide-white/5">
        {tickets.map((t) => {
          const open = t.status === "open";
          return (
            <li key={t.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-zinc-400">#{t.number}</span>
                    <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${open ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-zinc-500"}`}>
                      {open ? "In progress" : "Closed"}
                    </span>
                    <span className="truncate text-sm font-medium text-white">{t.subject}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{t.body}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {t.userName} · <a href={`mailto:${t.userEmail}?subject=${encodeURIComponent(`Re: SUPPORT TICKET #${t.number} · ${t.subject}`)}`} className="underline decoration-zinc-700 hover:text-zinc-300">{t.userEmail}</a>
                    {" · "}opened {fmtDate(t.createdAt)}
                    {t.closedAt ? ` · closed ${fmtDate(t.closedAt)}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setStatus(t.id, open ? "closed" : "open")}
                  disabled={pending === t.id}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                    open ? "bg-brand-500 text-white hover:bg-brand-400" : "border border-edge text-zinc-300 hover:border-edge-strong hover:text-white"
                  }`}
                >
                  {pending === t.id ? "…" : open ? "Close" : "Reopen"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
