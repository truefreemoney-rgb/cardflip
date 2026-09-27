"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiPath } from "@/lib/client/basePath";
import { fmtDate } from "@/components/admin/format";
import { PhotoPicker, ThreadBubble } from "@/components/TicketPhotos";
import type { TicketNote, TicketWithUser } from "@/lib/server/supportTickets";

type Tab = "live" | "closed";
type Row = TicketWithUser & { notes: TicketNote[] };

/**
 * Admin support (Chris 09-26): Live / Closed tabs, a ticket-number search,
 * and the ticket itself as a chat. Click a row → the thread: what the seller
 * sent, every turn since, and a reply box. A reply lands in the seller's
 * Help → Support Tickets and mails them "You Received a Reply". Close ends it
 * for both sides; Reopen brings it back.
 */
export default function SupportTickets({ initial, initialOpen = null }: { initial: Row[]; initialOpen?: string | null }) {
  const [tickets, setTickets] = useState(initial);
  const [tab, setTab] = useState<Tab>("live");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpen && initial.some((t) => t.id === initialOpen) ? initialOpen : null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (id: string, fn: (t: Row) => Row) => setTickets((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));

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
      patch(id, (t) => ({ ...t, ...data.ticket }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the ticket");
    } finally {
      setPending(null);
    }
  }

  const liveCount = tickets.filter((t) => t.status === "open").length;
  const closedCount = tickets.length - liveCount;
  const query = q.trim().replace(/^#/, "");
  // A number search looks across both tabs: the ticket is what matters, not where it sits.
  const shown = query
    ? tickets.filter((t) => String(t.number).startsWith(query))
    : tickets.filter((t) => (tab === "live" ? t.status === "open" : t.status === "closed"));
  const open = openId ? tickets.find((t) => t.id === openId) : null;

  if (open) {
    return (
      <Thread
        ticket={open}
        pending={pending === open.id}
        error={error}
        onBack={() => {
          setOpenId(null);
          setError(null);
        }}
        onStatus={(status) => setStatus(open.id, status)}
        onLoaded={(t) => patch(open.id, () => t)}
        onReplied={(note) => patch(open.id, (t) => ({ ...t, notes: [...t.notes, note], updatedAt: note.createdAt }))}
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div role="tablist" aria-label="Live or closed tickets" className="flex rounded-full border border-brand-400/40 bg-surface-1 p-0.5">
          {(["live", "closed"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 font-medium transition ${tab === t ? "bg-brand-500/30 text-white" : "text-zinc-400 hover:text-white"}`}
            >
              {t === "live" ? `Live${liveCount ? ` · ${liveCount}` : ""}` : `Closed${closedCount ? ` · ${closedCount}` : ""}`}
            </button>
          ))}
        </div>
        <input
          type="search"
          inputMode="numeric"
          aria-label="Search by ticket number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ticket #"
          className="w-28 rounded-full border border-edge bg-surface-1 px-4 py-1.5 text-base text-white placeholder:text-zinc-600 focus:border-brand-400 focus:outline-none sm:text-sm"
        />
        <span className={`ml-auto ${liveCount ? "text-amber-300" : "text-zinc-500"}`}>
          {liveCount ? `${liveCount} in progress` : "Nothing in progress"} · {tickets.length} total
        </span>
      </div>
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface-1 px-4 py-6 text-center text-sm text-zinc-500">
          {query
            ? `No ticket matching #${query}.`
            : tab === "live"
              ? tickets.length
                ? "No live tickets. Everything is closed."
                : "No support tickets yet. Sellers open them from the robot (Help → Open a support ticket)."
              : "No closed tickets yet."}
        </div>
      ) : (
        <div className="rounded-2xl border border-edge bg-surface-1">
          <ul className="divide-y divide-white/5">
            {shown.map((t) => {
              const isOpen = t.status === "open";
              const last = t.notes[t.notes.length - 1];
              // Seller spoke last (or nobody has replied yet) = it is on us.
              const waiting = isOpen && (!last || last.author === "seller");
              return (
                <li key={t.id}>
                  <button onClick={() => setOpenId(t.id)} className="block w-full px-4 py-3 text-left transition hover:bg-white/[0.03]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400">#{t.number}</span>
                      <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${isOpen ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-zinc-500"}`}>
                        {isOpen ? "In progress" : "Closed"}
                      </span>
                      {waiting && <span className="rounded-full bg-brand-500/20 px-2 py-px text-[11px] font-semibold text-brand-200">Needs a reply</span>}
                      <span className="truncate text-sm font-medium text-white">{t.subject}</span>
                      <span className="ml-auto text-[11px] text-zinc-500">{t.notes.length ? `${t.notes.length} in thread` : ""}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-zinc-400">{last ? last.body || "(photo)" : t.body}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {t.userName} · {t.userEmail} · Opened {fmtDate(t.createdAt)}
                      {t.closedAt ? ` · Closed ${fmtDate(t.closedAt)}` : ""}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One ticket as a chat, with the reply box and Close / Reopen. */
function Thread({
  ticket,
  pending,
  error,
  onBack,
  onStatus,
  onLoaded,
  onReplied,
}: {
  ticket: Row;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onStatus: (status: "open" | "closed") => void;
  onLoaded: (t: Row) => void;
  onReplied: (note: TicketNote) => void;
}) {
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isOpen = ticket.status === "open";

  // Refresh the thread on open: the page's list may predate a note the
  // seller just added.
  useEffect(() => {
    let cancelled = false;
    fetch(apiPath(`/api/admin/tickets/${ticket.id}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.ticket) onLoaded({ ...ticket, ...data.ticket });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  async function reply(e: FormEvent) {
    e.preventDefault();
    if (busy || (!body.trim() && images.length === 0)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiPath(`/api/admin/tickets/${ticket.id}/reply`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: body, images }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onReplied(data.note as TicketNote);
      setBody("");
      setImages([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send the reply");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="rounded-full border border-edge px-3 py-1.5 text-xs text-zinc-300 transition hover:border-edge-strong hover:text-white">
          ← All tickets
        </button>
        <span className="font-mono text-xs text-zinc-400">#{ticket.number}</span>
        <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${isOpen ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-zinc-500"}`}>
          {isOpen ? "In progress" : "Closed"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{ticket.subject}</span>
        <button
          onClick={() => onStatus(isOpen ? "closed" : "open")}
          disabled={pending}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
            isOpen ? "bg-brand-500 text-white hover:bg-brand-400" : "border border-edge text-zinc-300 hover:border-edge-strong hover:text-white"
          }`}
        >
          {pending ? "…" : isOpen ? "Close ticket" : "Reopen"}
        </button>
      </div>
      <p className="mb-3 text-[11px] text-zinc-500">
        {ticket.userName} · <a href={`mailto:${ticket.userEmail}`} className="underline decoration-zinc-700 hover:text-zinc-300">{ticket.userEmail}</a>
        {" · "}Opened {fmtDate(ticket.createdAt)}
        {ticket.closedAt ? ` · Closed ${fmtDate(ticket.closedAt)}` : ""}
      </p>
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

      {/* Same orientation as the seller's view, mirrored: our turns on the right. */}
      <div className="space-y-2.5 rounded-2xl border border-edge bg-surface-1 px-4 py-3">
        <ThreadBubble mine={false} who={ticket.userName || "Seller"} when={fmtDate(ticket.createdAt)} body={ticket.body} images={ticket.images} />
        {ticket.notes.map((n) =>
          n.author === "admin" ? (
            <ThreadBubble key={n.id} mine who="You" when={fmtDate(n.createdAt)} body={n.body} images={n.images} />
          ) : (
            <ThreadBubble key={n.id} mine={false} who={ticket.userName || "Seller"} when={fmtDate(n.createdAt)} body={n.body} images={n.images} />
          ),
        )}
      </div>

      {isOpen ? (
        <form onSubmit={reply} className="mt-3 flex flex-col gap-2 rounded-2xl border border-brand-400/30 bg-brand-500/5 px-4 py-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Reply to the seller"
            aria-label="Reply to the seller"
            className="resize-none rounded-xl border border-edge bg-black/40 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400"
          />
          <PhotoPicker urls={images} onChange={setImages} disabled={busy} uploadPath="/api/admin/tickets/image" />
          {err && <p className="text-xs text-amber-300">{err}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || (!body.trim() && images.length === 0)}
              className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Sending…" : "Send Reply"}
            </button>
            <span className="text-[11px] text-zinc-500">The seller sees it in Help and gets an email: SUPPORT TICKET #{ticket.number} · You Received a Reply.</span>
          </div>
        </form>
      ) : (
        <p className="mt-3 text-center text-[11px] text-zinc-500">Closed. Reopen to reply.</p>
      )}
    </div>
  );
}
