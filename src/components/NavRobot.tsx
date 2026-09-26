"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import RobotBuddy, { type RobotPose } from "@/components/RobotBuddy";
import Spinner from "@/components/Spinner";
import Link from "next/link";
import { apiPath } from "@/lib/client/basePath";
import { requestTourReplay } from "@/lib/client/tour";
import { HELP_LINKS, TAG_RE, guideById } from "@/lib/helpGuides";
import { startGuide } from "@/components/TourOverlay";
import { useBackToClose } from "@/lib/client/useBackToClose";

/**
 * The robot's home: a Help button in the app header (Chris, 09-04: "your AI
 * companion, lives in the nav, changes posture and attitude"). He shifts
 * pose every 20–40 s from a shortlist of moods; a tap opens the help chat —
 * one rolling conversation per account, answered by /api/help/chat, so it
 * carries across pages and sessions. Header lives in the app layout, so
 * this state survives navigation too.
 */

const MOODS: RobotPose[] = ["idle", "idle", "think", "shrug", "wave", "sleep", "idle", "celebrate"];

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: { type: "guide" | "link" | "ticket"; value: string }[];
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

/** What the panel shows: the chat, the ticket form, or the seller's tickets. */
type View = "chat" | "ticket" | "tickets";

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

export default function NavRobot() {
  const router = useRouter();
  const [pose, setPose] = useState<RobotPose>("idle");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Support tickets (Chris 09-26): the robot accepts and manages them.
  const [view, setView] = useState<View>("chat");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [tSubject, setTSubject] = useState("");
  const [tBody, setTBody] = useState("");
  const [tBusy, setTBusy] = useState(false);
  const [tError, setTError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // The panel is portalled to <body>: the header's backdrop-blur makes it a
  // containing block for position:fixed, so a sheet rendered inside it was
  // pinned to the header instead of the screen (Chris, 09-04, iPhone). On
  // desktop the panel anchors under the button by measuring it.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  // iOS doesn't shrink the layout viewport for the keyboard, so a bottom-0
  // sheet sits under it with its composer hidden (mobile QA 09-06). Same
  // visualViewport trick as CategorySheet: lift the sheet by the overlap.
  const [kbd, setKbd] = useState(0);
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKbd(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setKbd(0);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      const desktop = window.matchMedia("(min-width: 640px)").matches;
      setAnchor(desktop && r ? { left: r.left, top: r.bottom + 6 } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // Wander through moods. Never the same one twice in a row.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setPose((prev) => {
        let next = prev;
        while (next === prev) next = MOODS[Math.floor(Math.random() * MOODS.length)];
        return next;
      });
      timer = window.setTimeout(tick, 20000 + Math.random() * 20000);
    };
    timer = window.setTimeout(tick, 8000 + Math.random() * 8000);
    return () => window.clearTimeout(timer);
  }, []);

  // History loads on first open; afterwards the panel keeps what it has.
  useEffect(() => {
    if (!open || messages !== null) return;
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
  }, [open, messages]);

  // Tickets load on first open too (the footer shows the open count).
  useEffect(() => {
    if (!open || tickets !== null) return;
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
  }, [open, tickets]);

  // Newest message in view; focus the box when the panel opens.
  useEffect(() => {
    if (!open || view !== "chat") return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    if (!busy) inputRef.current?.focus();
  }, [open, messages, busy, view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // Android Back closes the help panel, not the app.
  const closePanel = useCallback(() => setOpen(false), []);
  useBackToClose("help", closePanel, open);

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
        setMessages((m) => [...(m ?? []), data.reply as Msg]);
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
      if (tBusy || !tBody.trim()) return;
      setTBusy(true);
      setTError(null);
      try {
        const res = await fetch(apiPath("/api/help/tickets"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: tSubject, message: tBody }),
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
        setMessages((m) => [
          ...(m ?? []),
          {
            id: `local-ticket-${t.id}`,
            role: "assistant",
            content: `Ticket #${t.number} is open. Status: In progress. A human reads it and replies to your email. Open the Support tab any time to check on it.`,
          },
        ]);
        setView("chat");
      } catch {
        setTError("No connection. Try again in a moment.");
      } finally {
        setTBusy(false);
      }
    },
    [tBusy, tBody, tSubject],
  );

  const clear = useCallback(async () => {
    setMessages([]);
    setError(null);
    await fetch(apiPath("/api/help/chat"), { method: "DELETE" }).catch(() => undefined);
  }, []);

  const headerPose: RobotPose = open ? (busy ? "think" : "wave") : pose;

  function ask(text: string) {
    void sendText(text);
  }
  function runGuide(id: string) {
    const g = guideById(id);
    if (!g) return;
    setOpen(false);
    startGuide(g.steps);
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Help"
        data-tour="help"
        aria-expanded={open}
        title="Help"
        className="flex h-9 flex-col items-center justify-center rounded-full px-1 py-0.5 text-xs font-medium text-zinc-300 transition hover:bg-surface-2 hover:text-white sm:flex-row sm:gap-1 sm:py-1 sm:pr-2.5"
      >
        <RobotBuddy pose={headerPose} size={26} float={false} />
        {/* The word is always on (Chris 09-26: on phones "the reason for it
            is kind of unknown to the user"). On phones it sits UNDER the
            robot as a caption: beside him it made the strip wrap under the
            logo on an owner's phone (Help · 100/100 · eBay, 09-26 evening).
            From sm it rides beside him as before. */}
        <span className="text-[9px] leading-none sm:text-xs sm:leading-normal">Help</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          {/* Phones: dim the page behind the sheet; a tap outside closes. */}
          <button
            className="fixed inset-0 z-40 cursor-default bg-black/50 sm:hidden"
            aria-label="Close help"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Help"
            style={anchor ?? (kbd > 0 ? { bottom: kbd } : undefined)}
            className="fixed inset-x-0 bottom-0 z-50 panel-solid flex max-h-[80dvh] flex-col rounded-t-2xl border shadow-2xl shadow-black/70 sm:inset-x-auto sm:bottom-auto sm:h-[520px] sm:max-h-[70vh] sm:w-[360px] sm:rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
              <RobotBuddy pose={busy ? "think" : "idle"} size={28} float={false} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{view === "chat" ? "The robot" : view === "ticket" ? "New support ticket" : "Support"}</p>
                <p className="truncate text-[11px] text-zinc-500">
                  {view === "chat" ? "Help, tours, moral support" : view === "ticket" ? "A human reads it and emails you back" : "Your tickets. A human replies by email."}
                </p>
              </div>
              {view === "ticket" && (
                <button onClick={() => setView("tickets")} className="text-[11px] text-zinc-400 transition hover:text-white">
                  Back
                </button>
              )}
              {view === "chat" && messages && messages.length > 0 && (
                <button onClick={clear} className="text-[11px] text-zinc-500 transition hover:text-zinc-300">
                  Clear
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close help"
                className="-mr-1.5 flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition hover:bg-surface-2 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Chat / Support tabs (Chris 09-26): tickets live in a tab, not footer links. */}
            <div role="tablist" aria-label="Chat or support" className="flex border-b border-edge px-2">
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
                    {t === "chat" ? "Chat" : "Support"}
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
                  className="rounded-xl border border-edge bg-black/40 px-3.5 py-2 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm"
                />
                <textarea
                  value={tBody}
                  onChange={(e) => setTBody(e.target.value)}
                  maxLength={2000}
                  rows={6}
                  autoFocus
                  placeholder="What's wrong?"
                  aria-label="What's wrong"
                  className="min-h-[9rem] flex-1 resize-none rounded-xl border border-edge bg-black/40 px-3.5 py-2 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 sm:text-sm"
                />
                {tError && <p className="text-xs text-amber-300">{tError}</p>}
                <button
                  type="submit"
                  disabled={tBusy || !tBody.trim()}
                  className="rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {tBusy ? "Sending…" : "Send ticket"}
                </button>
                <p className="text-center text-[11px] text-zinc-600">You get a copy by email with the ticket number.</p>
              </form>
            )}

            {view === "tickets" && (
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
                <button
                  onClick={() => setView("ticket")}
                  className="rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400"
                >
                  Open a support ticket
                </button>
                <p className="text-center text-[11px] text-zinc-600">A human reads it and replies to your email, usually within 24 hours.</p>
                {tickets === null && (
                  <p className="text-center text-[11px] text-zinc-600">
                    <Spinner className="mr-1 inline h-3 w-3" /> Loading…
                  </p>
                )}
                {tickets && tickets.length === 0 && (
                  <p className="py-4 text-center text-sm text-zinc-500">No tickets yet.</p>
                )}
                {tickets?.map((t) => (
                  <div key={t.id} className="rounded-xl border border-edge bg-surface-2/60 px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400">#{t.number}</span>
                      <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${t.status === "open" ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-zinc-500"}`}>
                        {t.statusLabel}
                      </span>
                      <span className="ml-auto text-[11px] text-zinc-600">{new Date(t.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-zinc-200">{t.subject}</p>
                  </div>
                ))}
              </div>
            )}

            <div ref={listRef} className={`flex-1 space-y-2.5 overflow-y-auto px-4 py-3 ${view === "chat" ? "" : "hidden"}`}>
              <Bubble role="assistant">{OPENER}</Bubble>
              {messages === null && (
                <p className="text-center text-[11px] text-zinc-600">
                  <Spinner className="mr-1 inline h-3 w-3" /> remembering…
                </p>
              )}
              {messages && messages.length === 0 && (
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
                const g = guideId ? guideById(guideId) : null;
                return (
                  <div key={m.id} className="flex flex-col items-start gap-1.5">
                    <Bubble role="assistant">{text}</Bubble>
                    {(g || link || ticket) && (
                      <div className="flex flex-wrap gap-1.5 pl-1">
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
                            onClick={() => setOpen(false)}
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
                <button
                  onClick={() => {
                    setOpen(false);
                    requestTourReplay();
                    router.push("/app");
                  }}
                  className="transition hover:text-zinc-300"
                >
                  Replay the tour
                </button>
              </div>
            )}

            <form
              onSubmit={send}
              className={`flex items-center gap-2 border-t border-edge px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] ${view === "chat" ? "" : "hidden"}`}
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
        </>,
        document.body,
      )}
    </div>
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
