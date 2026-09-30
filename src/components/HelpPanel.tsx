"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import RobotBuddy from "@/components/RobotBuddy";
import Spinner from "@/components/Spinner";
import { PhotoPicker, ThreadBubble } from "@/components/TicketPhotos";
import { apiPath } from "@/lib/client/basePath";
import { useOptionalSession } from "@/components/SessionProvider";
import { requestTourReplay } from "@/lib/client/tour";
import { HELP_LINKS, TAG_RE, guideById } from "@/lib/helpGuides";
import { startGuide } from "@/components/TourOverlay";
import { etDate, etDateTime } from "@/lib/time";

/**
 * The help robot's body: Chat / Support Tickets tabs, the ticket form, a
 * ticket's chat (what they sent, CardFlip's replies, and a box to add more
 * while it is open) and the composer. Two homes (Chris 09-26, "popups can
 * be frustrating for mobile users"): the desktop popover under the header
 * button (NavRobot) and the full page at /app/help on phones. Same state
 * and markup in both, so a fix lands in both. One rolling conversation per
 * account (/api/help/chat).
 */

export interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: { type: "guide" | "link" | "ticket" | "opened"; value: string }[];
}

interface Ticket {
  id: string;
  number: number;
  subject: string;
  status: "open" | "closed";
  statusLabel: string;
  createdAt: number;
  closedAt: number | null;
}

interface Note {
  id: string;
  author: "seller" | "admin";
  body: string;
  images: string[];
  createdAt: number;
}

interface TicketDetail extends Ticket {
  body: string;
  images: string[];
  notes: Note[];
}

/** What the panel shows: the chat, the ticket form, the seller's tickets, or one ticket. */
type View = "chat" | "ticket" | "tickets" | "detail";

const OPENER = "Ask me anything about CardFlip. Scans, prices, eBay, billing. I read the manual so you don't have to.";

/** Empty-chat starters (Chris, 09-04: solve 99% the easiest way — nobody should have to type). */
const STARTERS = [
  "How do I connect eBay?",
  "Why can't I publish yet?",
  "How do I change a listed price?",
  "Where do the prices come from?",
  "How do I get emailed when a card dips?",
  "What does my plan include?",
];

/** Split a reply into its text and the actions the robot tagged. */
function parseReply(content: string): { text: string; guide: string | null; link: string | null; ticket: boolean } {
  let guide: string | null = null;
  let link: string | null = null;
  let ticket = false;
  const text = content
    .replace(TAG_RE, (_, kind: string, value: string | undefined) => {
      const v = (value ?? "").trim();
      if (kind === "guide" && guideById(v)) guide = v;
      if (kind === "link" && v in HELP_LINKS) link = v;
      if (kind === "ticket") ticket = true;
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, guide, link, ticket };
}

/** "Sep 30, 6:22 AM ET" — Eastern for every viewer, same clock as the admin side (Chris 09-30). */
const fmtWhen = (ms: number) => etDateTime(ms);

interface Props {
  /** "sheet" = the desktop popover (has a close button, fixed height); "page" = /app/help (scrolls like a page). */
  mode: "sheet" | "page";
  /** Sheet: whether it is open (history loads on first open). Page: always true. */
  active: boolean;
  /** Sheet only: close it (the ✕, a guide starting, a link opening). */
  onClose?: () => void;
  /** Reports the robot's mood to the header button. */
  onBusy?: (busy: boolean) => void;
}

export default function HelpPanel({ mode, active, onClose, onBusy }: Props) {
  const router = useRouter();
  const sheet = mode === "sheet";
  // Waiting on the emailed code: the server sends this account no support mail
  // (that address is unproven), so replies live in the Support Tickets tab only
  // and the copy must not promise an email.
  const emailPending = Boolean(useOptionalSession()?.user?.mustConfirmEmail);
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Support tickets (Chris 09-26): the robot accepts and manages them.
  const [view, setView] = useState<View>("chat");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [tSubject, setTSubject] = useState("");
  const [tBody, setTBody] = useState("");
  const [tImages, setTImages] = useState<string[]>([]);
  const [tBusy, setTBusy] = useState(false);
  const [tError, setTError] = useState<string | null>(null);
  // One ticket, opened from the list.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [nBody, setNBody] = useState("");
  const [nImages, setNImages] = useState<string[]>([]);
  const [nBusy, setNBusy] = useState(false);
  const [nError, setNError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);

  // History loads on first open; afterwards the panel keeps what it has.
  useEffect(() => {
    if (!active || messages !== null) return;
    let cancelled = false;
    fetch(apiPath("/api/help/chat"))
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active, messages]);

  // Tickets load on first open too (the tab shows the open count).
  useEffect(() => {
    if (!active || tickets !== null) return;
    let cancelled = false;
    fetch(apiPath("/api/help/tickets"))
      .then((r) => (r.ok ? r.json() : { tickets: [] }))
      .then((data) => {
        if (!cancelled) setTickets(data.tickets ?? []);
      })
      .catch(() => {
        if (!cancelled) setTickets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active, tickets]);

  // One ticket's detail loads when it is opened.
  useEffect(() => {
    if (view !== "detail" || !detailId) return;
    let cancelled = false;
    fetch(apiPath(`/api/help/tickets/${detailId}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setDetail(data?.ticket ?? null);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [view, detailId]);

  // Newest message in view. The sheet focuses the box when it opens; the
  // page doesn't (a keyboard popping up on page load is the thing we're
  // trying to stop happening to phone users).
  useEffect(() => {
    if (!active || view !== "chat") return;
    // An empty chat stays at the top so the opener is the first thing read.
    if (sheet) {
      if (messages && messages.length > 0) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      if (!busy) inputRef.current?.focus();
    } else if (messages && messages.length > 0) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [active, messages, busy, view, sheet]);

  // One send path for the typed draft and the starter chips. The chips used
  // to set the draft and `requestSubmit()` on a timer — older iOS Safari has
  // no requestSubmit and threw.
  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setDraft("");
      setError(null);
      setBusy(true);
      const mine: Msg = { id: `local-${Date.now()}`, role: "user", content: text };
      setMessages((m) => [...(m ?? []), mine]);
      try {
        const res = await fetch(apiPath("/api/help/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "The robot didn't answer. Try again.");
          return;
        }
        const reply = data.reply as Msg;
        setMessages((m) => [...(m ?? []), reply]);
        // The robot opened a ticket in this turn: reload the list so the
        // Support Tickets tab and its badge show it.
        if (reply.actions?.some((a) => a.type === "opened")) setTickets(null);
      } catch {
        setError("No connection. Try again in a moment.");
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );
  const send = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void sendText(draft);
    },
    [sendText, draft],
  );

  const openCount = tickets?.filter((t) => t.status === "open").length ?? 0;

  // Open a ticket: the row + mail happen server-side; the chat gets a
  // confirmation bubble so the number is right there in the thread.
  const submitTicket = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (tBusy || (!tBody.trim() && tImages.length === 0)) return;
      setTBusy(true);
      setTError(null);
      try {
        const res = await fetch(apiPath("/api/help/tickets"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: tSubject, message: tBody, images: tImages }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setTError(data.error || "Couldn't open the ticket. Try again.");
          return;
        }
        const t = data.ticket as Ticket;
        setTickets((prev) => [t, ...(prev ?? [])]);
        setTSubject("");
        setTBody("");
        setTImages([]);
        setMessages((m) => [
          ...(m ?? []),
          {
            id: `local-ticket-${t.id}`,
            role: "assistant",
            content: `Ticket #${t.number} is open. Status: In progress. A human reads it and replies ${emailPending ? "here" : "to your email"}, usually within 24 hours. Open the Support Tickets tab any time to check on it.`,
          },
        ]);
        setView("chat");
      } catch {
        setTError("No connection. Try again in a moment.");
      } finally {
        setTBusy(false);
      }
    },
    [tBusy, tBody, tSubject, tImages, emailPending],
  );

  // Add to an open ticket.
  const submitNote = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!detail || nBusy || (!nBody.trim() && nImages.length === 0)) return;
      setNBusy(true);
      setNError(null);
      try {
        const res = await fetch(apiPath(`/api/help/tickets/${detail.id}/notes`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: nBody, images: nImages }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setNError(data.error || "Couldn't add that. Try again.");
          return;
        }
        setDetail((d) => (d ? { ...d, notes: [...d.notes, data.note as Note] } : d));
        setNBody("");
        setNImages([]);
      } catch {
        setNError("No connection. Try again in a moment.");
      } finally {
        setNBusy(false);
      }
    },
    [detail, nBusy, nBody, nImages],
  );

  const clear = useCallback(async () => {
    setMessages([]);
    setError(null);
    await fetch(apiPath("/api/help/chat"), { method: "DELETE" }).catch(() => undefined);
  }, []);

  function ask(text: string) {
    void sendText(text);
  }
  function openDetail(id: string) {
    setDetailId(id);
    setDetail(null);
    setNBody("");
    setNImages([]);
    setNError(null);
    setView("detail");
  }
  // Guides spotlight the real app pages: leave the help surface first. The
  // page version goes to the scanner, where every guide begins.
  function runGuide(id: string) {
    const g = guideById(id);
    if (!g) return;
    if (sheet) onClose?.();
    else router.push("/app");
    startGuide(g.steps);
  }
  function replayTour() {
    if (sheet) onClose?.();
    requestTourReplay();
    router.push("/app");
  }

  const title =
    view === "chat" ? "The robot" : view === "ticket" ? "New support ticket" : view === "detail" ? (detail ? `Ticket #${detail.number}` : "Ticket") : "Support Tickets";
  const subtitle =
    view === "chat"
      ? "Help, tours, moral support"
      : view === "ticket"
        ? "A human reads it and replies here"
        : view === "detail"
          ? detail?.status === "open"
            ? emailPending
              ? "In progress. Replies show up here."
              : "In progress. Replies show up here and in your email."
            : "Closed."
          : "Your tickets. Tap one to read the replies.";
  const field = "rounded-xl border border-edge bg-black/40 px-3.5 py-2 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm";
  const primary = "rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className={sheet ? "flex min-h-0 flex-1 flex-col" : "flex flex-1 flex-col"}>
      <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
        <RobotBuddy pose={busy ? "think" : "idle"} size={28} float={false} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="truncate text-[11px] text-zinc-500">{subtitle}</p>
        </div>
        {(view === "ticket" || view === "detail") && (
          <button onClick={() => setView("tickets")} className="text-[11px] text-zinc-400 transition hover:text-white">
            Back
          </button>
        )}
        {view === "chat" && messages && messages.length > 0 && (
          <button onClick={clear} className="text-[11px] text-zinc-500 transition hover:text-zinc-300">
            Clear
          </button>
        )}
        {sheet && (
          <button
            onClick={onClose}
            aria-label="Close help"
            className="-mr-1.5 flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition hover:bg-surface-2 hover:text-white"
          >
            ✕
          </button>
        )}
      </div>

      {/* Chat / Support Tickets tabs (Chris 09-26): tickets live in a tab, not footer links. */}
      <div role="tablist" aria-label="Chat or support tickets" className="flex border-b border-edge px-2">
        {(["chat", "tickets"] as const).map((t) => {
          const selected = t === "chat" ? view === "chat" : view !== "chat";
          return (
            <button
              key={t}
              role="tab"
              aria-selected={selected}
              onClick={() => setView(t)}
              className={`-mb-px flex-1 border-b-2 px-3 py-2 text-xs font-semibold transition ${
                selected ? "border-brand-400 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t === "chat" ? "Chat" : "Support Tickets"}
              {t === "tickets" && openCount > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-400/15 px-1.5 py-px text-[10px] text-amber-300">{openCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {view === "ticket" && (
        <form onSubmit={submitTicket} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <p className="text-sm text-zinc-300">Say what went wrong and what you expected. Include the card or listing if there is one.</p>
          <input
            value={tSubject}
            onChange={(e) => setTSubject(e.target.value)}
            maxLength={80}
            placeholder="Subject (optional)"
            aria-label="Subject"
            className={field}
          />
          <textarea
            value={tBody}
            onChange={(e) => setTBody(e.target.value)}
            maxLength={2000}
            rows={6}
            autoFocus
            placeholder="What's wrong?"
            aria-label="What's wrong"
            className={`min-h-[9rem] flex-1 resize-none ${field}`}
          />
          <PhotoPicker urls={tImages} onChange={setTImages} disabled={tBusy} />
          {tError && <p className="text-xs text-amber-300">{tError}</p>}
          <button type="submit" disabled={tBusy || (!tBody.trim() && tImages.length === 0)} className={primary}>
            {tBusy ? "Sending…" : "Send ticket"}
          </button>
          <p className="text-center text-[11px] text-zinc-600">
            {emailPending ? "A human replies on the ticket. Check the Support Tickets tab for the answer." : "You get an email with the ticket number, and another when a human replies."}
          </p>
        </form>
      )}

      {view === "tickets" && (
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
          <button onClick={() => setView("ticket")} className={primary}>
            Open a support ticket
          </button>
          <p className="text-center text-[11px] text-zinc-600">
            A human reads it and replies on the ticket, usually within 24 hours.{emailPending ? "" : " You get an email when they do."}
          </p>
          {tickets === null && (
            <p className="text-center text-[11px] text-zinc-600">
              <Spinner className="mr-1 inline h-3 w-3" /> Loading…
            </p>
          )}
          {tickets && tickets.length === 0 && <p className="py-4 text-center text-sm text-zinc-500">No tickets yet.</p>}
          {tickets?.map((t) => (
            <button
              key={t.id}
              onClick={() => openDetail(t.id)}
              className="rounded-xl border border-edge bg-surface-2/60 px-3.5 py-2.5 text-left transition hover:border-edge-strong"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-zinc-400">#{t.number}</span>
                <StatusChip status={t.status} label={t.statusLabel} />
                <span className="ml-auto text-[11px] text-zinc-600">{etDate(t.createdAt, "", { month: "short", day: "numeric" })}</span>
              </div>
              <p className="mt-1 truncate text-sm text-zinc-200">{t.subject}</p>
            </button>
          ))}
        </div>
      )}

      {view === "detail" && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {detail === null && (
            <p className="text-center text-[11px] text-zinc-600">
              <Spinner className="mr-1 inline h-3 w-3" /> Loading…
            </p>
          )}
          {detail && (
            <>
              <div className="flex items-center gap-2">
                <StatusChip status={detail.status} label={detail.statusLabel} />
                <span className="truncate text-sm font-medium text-white">{detail.subject}</span>
              </div>
              {/* The ticket is a chat (Chris 09-26): what they sent first, then
                  every turn in order. Theirs on the right, CardFlip's on the left. */}
              <ThreadBubble
                mine
                who="You"
                when={fmtWhen(detail.createdAt)}
                body={detail.body}
                images={detail.images}
              />
              {detail.notes.map((n) =>
                n.author === "admin" ? (
                  <ThreadBubble key={n.id} mine={false} who="CardFlip Support" when={fmtWhen(n.createdAt)} body={n.body} images={n.images} />
                ) : (
                  <ThreadBubble key={n.id} mine who="You" when={fmtWhen(n.createdAt)} body={n.body} images={n.images} />
                ),
              )}
              {detail.notes.every((n) => n.author !== "admin") && detail.status === "open" && (
                <p className="text-center text-[11px] text-zinc-600">
                  A human replies here, usually within 24 hours.{emailPending ? "" : " You get an email when they do."}
                </p>
              )}
              {detail.status === "open" ? (
                <form onSubmit={submitNote} className="flex flex-col gap-2 rounded-xl border border-brand-400/30 bg-brand-500/5 px-3.5 py-3">
                  <textarea
                    value={nBody}
                    onChange={(e) => setNBody(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="Reply or add more detail"
                    aria-label="Reply or add more detail"
                    className={`resize-none ${field}`}
                  />
                  <PhotoPicker urls={nImages} onChange={setNImages} disabled={nBusy} />
                  {nError && <p className="text-xs text-amber-300">{nError}</p>}
                  <button type="submit" disabled={nBusy || (!nBody.trim() && nImages.length === 0)} className={primary}>
                    {nBusy ? "Sending…" : "Send"}
                  </button>
                </form>
              ) : (
                <p className="text-center text-[11px] text-zinc-600">
                  Closed {detail.closedAt ? fmtWhen(detail.closedAt) : ""}. Still stuck?{" "}
                  <button onClick={() => setView("ticket")} className="underline decoration-zinc-700 transition hover:text-zinc-300">
                    Open a new ticket
                  </button>
                  .
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div ref={listRef} className={`flex-1 space-y-2.5 px-4 py-3 ${sheet ? "overflow-y-auto" : ""} ${view === "chat" ? "" : "hidden"}`}>
        <Bubble role="assistant">{OPENER}</Bubble>
        {messages === null && (
          <p className="text-center text-[11px] text-zinc-600">
            <Spinner className="mr-1 inline h-3 w-3" /> remembering…
          </p>
        )}
        {messages && messages.length === 0 && (
          <>
            {/* Someone opening Help is often already annoyed (Chris 09-26): one
                obvious exit that needs no typing, before the questions. */}
            <button
              onClick={() => setView("ticket")}
              className="flex w-full items-center justify-between rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-left text-sm font-semibold text-amber-200 transition hover:bg-amber-400/15"
            >
              <span>Open a support ticket</span>
              <span aria-hidden className="text-amber-300/70">→</span>
            </button>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="rounded-full border border-edge bg-surface-2/60 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-edge-strong hover:text-white"
                >
                  {q}
                </button>
              ))}
            </div>
          </>
        )}
        {messages?.map((m) => {
          if (m.role === "user") {
            return (
              <Bubble key={m.id} role="user">
                {m.content}
              </Bubble>
            );
          }
          // Server sends clean text + actions; the parse is a fallback for
          // a reply that still carries raw tags (older server, same client).
          const parsed = parseReply(m.content);
          const text = parsed.text;
          const guideId = m.actions?.find((a) => a.type === "guide")?.value ?? parsed.guide;
          const link = m.actions?.find((a) => a.type === "link")?.value ?? parsed.link;
          const ticket = m.actions?.some((a) => a.type === "ticket") || parsed.ticket;
          const opened = m.actions?.find((a) => a.type === "opened")?.value;
          const g = guideId ? guideById(guideId) : null;
          return (
            <div key={m.id} className="flex flex-col items-start gap-1.5">
              <Bubble role="assistant">{text}</Bubble>
              {(g || link || ticket || opened) && (
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {opened && (
                    <button
                      onClick={() => setView("tickets")}
                      className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-edge-strong hover:text-white"
                    >
                      View ticket #{opened}
                    </button>
                  )}
                  {ticket && (
                    <button
                      onClick={() => setView("ticket")}
                      className="rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400"
                    >
                      Open a support ticket
                    </button>
                  )}
                  {g && (
                    <button
                      onClick={() => runGuide(g.id)}
                      className="rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400"
                    >
                      Walk me through it
                    </button>
                  )}
                  {link && (
                    <Link
                      href={link}
                      onClick={sheet ? onClose : undefined}
                      className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-edge-strong hover:text-white"
                    >
                      Open {HELP_LINKS[link]}
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <Bubble role="assistant">
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <Spinner className="h-3 w-3" /> thinking
            </span>
          </Bubble>
        )}
        {error && <p className="text-xs text-amber-300">{error}</p>}
      </div>

      {view === "chat" && (
        <div className="px-4 pb-1 text-[11px] text-zinc-500">
          <button onClick={replayTour} className="transition hover:text-zinc-300">
            Replay the tour
          </button>
        </div>
      )}

      {/* The page version keeps the composer pinned to the bottom of the
          screen while the thread scrolls as a normal page — no sheet math,
          no lost draft on a stray tap. */}
      <form
        onSubmit={send}
        className={`flex items-center gap-2 border-t border-edge px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] ${
          sheet ? "" : "sticky bottom-0 bg-background"
        } ${view === "chat" ? "" : "hidden"}`}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={600}
          placeholder="Ask the robot"
          aria-label="Your question"
          className="min-w-0 flex-1 rounded-full border border-edge bg-black/40 px-3.5 py-2 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-full bg-brand-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function StatusChip({ status, label }: { status: "open" | "closed"; label: string }) {
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold ${status === "open" ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-zinc-500"}`}>
      {label}
    </span>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          mine ? "rounded-br-md bg-brand-500 text-white" : "rounded-bl-md bg-surface-2 text-zinc-200"
        }`}
      >
        {children}
      </p>
    </div>
  );
}
